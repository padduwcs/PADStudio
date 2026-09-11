export class ElevenLabsError extends Error {
  constructor(message, { code = "elevenlabs_error", requestSubmitted = false, status = null } = {}) {
    super(message);
    this.name = "ElevenLabsError";
    this.code = code;
    this.requestSubmitted = requestSubmitted;
    this.status = status;
  }
}

function safeId(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,100}$/.test(value)) {
    throw new ElevenLabsError(label + " is invalid.", { code: "invalid_input" });
  }
  return value;
}

function apiError(response, action, submitted = false) {
  const suffix = response.status === 401 ? " Check the local API key." :
    response.status === 429 ? " Credit or rate limit reached." : "";
  return new ElevenLabsError(`ElevenLabs ${action} failed with HTTP ${response.status}.${suffix}`, {
    code: response.status === 401 ? "credential_rejected" :
      response.status === 429 ? "provider_limit" : "provider_error",
    requestSubmitted: submitted,
    status: response.status
  });
}

export class ElevenLabsClient {
  constructor({ apiKey, fetchImpl = globalThis.fetch, baseUrl = "https://api.elevenlabs.io" }) {
    if (typeof apiKey !== "string" || !apiKey.trim()) {
      throw new ElevenLabsError("ElevenLabs API key is not configured.", { code: "tool_unavailable" });
    }
    if (typeof fetchImpl !== "function") throw new ElevenLabsError("A fetch implementation is required.");
    this.apiKey = apiKey.trim();
    this.fetch = fetchImpl;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async request(path, { method = "GET", body, signal, submitted = false } = {}) {
    let response;
    try {
      response = await this.fetch(this.baseUrl + path, {
        method, signal,
        headers: { "xi-api-key": this.apiKey, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    } catch {
      throw new ElevenLabsError("Could not reach ElevenLabs.", {
        code: "provider_unreachable", requestSubmitted: submitted
      });
    }
    if (!response.ok) throw apiError(response, method + " " + path.split("?")[0], submitted);
    return response;
  }

  async inspect({ language = "vi", signal } = {}) {
    const [subscriptionResponse, modelsResponse, voicesResponse] = await Promise.all([
      this.request("/v1/user/subscription", { signal }),
      this.request("/v1/models", { signal }),
      this.request("/v2/voices?language=" + encodeURIComponent(language) + "&page_size=100", { signal })
    ]);
    const [subscription, modelsValue, voicesValue] = await Promise.all([
      subscriptionResponse.json(), modelsResponse.json(), voicesResponse.json()
    ]);
    const models = (Array.isArray(modelsValue) ? modelsValue : [])
      .filter((model) => model.can_do_text_to_speech !== false)
      .map((model) => ({
        modelId: model.model_id, name: model.name,
        languages: Array.isArray(model.languages) ? model.languages.map((entry) => ({
          languageId: entry.language_id ?? entry.language_code ?? null, name: entry.name ?? null
        })) : [],
        maxCharactersRequestFreeUser: model.max_characters_request_free_user ?? null,
        maxCharactersRequestSubscribedUser: model.max_characters_request_subscribed_user ?? null,
        creditMultiplier: Number(model.model_rates?.character_cost_multiplier ?? model.token_cost_factor ?? 1)
      }));
    const voices = (Array.isArray(voicesValue?.voices) ? voicesValue.voices : []).map((voice) => ({
      voiceId: voice.voice_id, name: voice.name, category: voice.category ?? null,
      description: voice.description ?? null, labels: voice.labels ?? {},
      verifiedLanguages: voice.verified_languages ?? [], previewUrl: voice.preview_url ?? null
    }));
    return {
      status: "connected",
      subscription: {
        status: subscription.status ?? null, characterCount: subscription.character_count ?? null,
        characterLimit: subscription.character_limit ?? null,
        canExtendCharacterLimit: subscription.can_extend_character_limit ?? null
      },
      models, voices
    };
  }

  async estimate({ text, modelId, signal }) {
    const catalog = await this.inspect({ language: "vi", signal });
    const model = catalog.models.find((entry) => entry.modelId === modelId);
    if (!model) throw new ElevenLabsError("Selected ElevenLabs model is not available.", { code: "invalid_input" });
    const multiplier = Number.isFinite(model.creditMultiplier) && model.creditMultiplier > 0 ? model.creditMultiplier : 1;
    return {
      usage: {
        unit: "credits",
        amount: Math.ceil([...text].length * multiplier),
        basis: `unicode_characters:${[...text].length};model_multiplier:${multiplier}`
      },
      catalog
    };
  }

  async synthesize({ voiceId, modelId, text, voiceSettings, outputFormat, seed, signal }) {
    const response = await this.request(
      "/v1/text-to-speech/" + encodeURIComponent(safeId(voiceId, "voiceId")) +
        "?output_format=" + encodeURIComponent(outputFormat),
      {
        method: "POST", signal, submitted: true,
        body: {
          text, model_id: safeId(modelId, "modelId"), voice_settings: voiceSettings,
          ...(seed === null ? {} : { seed })
        }
      }
    );
    const characterCost = response.headers.get("character-cost");
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      actualCredits: characterCost === null ? null : Number(characterCost),
      providerRequestId: response.headers.get("request-id"),
      traceId: response.headers.get("x-trace-id")
    };
  }
}
