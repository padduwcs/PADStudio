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

function languageCode(value) {
  if (typeof value !== "string" || !/^[a-z]{2}$/.test(value)) {
    throw new ElevenLabsError("languageCode must be a lowercase ISO 639-1 code.", { code: "invalid_input" });
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

function submittedError(message, code = "provider_error") {
  return new ElevenLabsError(message, { code, requestSubmitted: true });
}

function mapModel(model, requestedLanguage) {
  const languages = Array.isArray(model.languages) ? model.languages.map((entry) => ({
    languageId: entry.language_id ?? entry.language_code ?? null, name: entry.name ?? null
  })) : [];
  return {
    modelId: model.model_id, name: model.name, languages,
    supportsRequestedLanguage: languages.length === 0 ? null :
      languages.some((entry) => entry.languageId === requestedLanguage),
    canUseStyle: model.can_use_style ?? null,
    canUseSpeakerBoost: model.can_use_speaker_boost ?? null,
    maximumTextLengthPerRequest: model.maximum_text_length_per_request ?? null,
    maxCharactersRequestFreeUser: model.max_characters_request_free_user ?? null,
    maxCharactersRequestSubscribedUser: model.max_characters_request_subscribed_user ?? null,
    creditMultiplier: (() => {
      const value = Number(model.model_rates?.character_cost_multiplier ?? model.token_cost_factor);
      return Number.isFinite(value) && value > 0 ? value : null;
    })()
  };
}

function mapVoice(voice) {
  const rate = Number(voice.sharing?.rate ?? voice.rate);
  return {
    voiceId: voice.voice_id, name: voice.name, category: voice.category ?? null,
    description: voice.description ?? null, labels: voice.labels ?? {},
    verifiedLanguages: voice.verified_languages ?? [], previewUrl: voice.preview_url ?? null,
    customRate: Number.isFinite(rate) && rate > 0 ? rate : null
  };
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

  async responseJson(response, label) {
    try {
      return await response.json();
    } catch {
      throw new ElevenLabsError("ElevenLabs returned invalid " + label + " data.", { code: "provider_error" });
    }
  }

  async listVoices(language, signal) {
    const voices = [];
    let token = null;
    const seen = new Set();
    for (let page = 0; page < 20; page += 1) {
      const query = new URLSearchParams({
        language,
        page_size: "100",
        include_custom_rates: "false"
      });
      if (token) query.set("next_page_token", token);
      const response = await this.request("/v2/voices?" + query, { signal });
      const value = await this.responseJson(response, "voice catalog");
      voices.push(...(Array.isArray(value?.voices) ? value.voices : []));
      if (!value?.has_more) return voices;
      if (typeof value.next_page_token !== "string" || !value.next_page_token || seen.has(value.next_page_token)) {
        throw new ElevenLabsError("ElevenLabs voice pagination returned an invalid continuation token.", {
          code: "provider_error"
        });
      }
      seen.add(value.next_page_token);
      token = value.next_page_token;
    }
    throw new ElevenLabsError("ElevenLabs voice catalog exceeded the 20-page safety limit.", {
      code: "provider_error"
    });
  }

  /** Voices that can synthesize `language`, optionally narrowed by a name search, one page at a time. */
  async searchVoices({ language = "vi", search = "", pageToken = null, pageSize = 30, signal } = {}) {
    const query = new URLSearchParams({
      language: languageCode(language),
      page_size: String(Math.min(100, Math.max(1, Math.trunc(pageSize)))),
      include_custom_rates: "false"
    });
    const text = String(search ?? "").trim().slice(0, 100);
    if (text) query.set("search", text);
    if (pageToken) query.set("next_page_token", String(pageToken).slice(0, 500));
    const value = await this.responseJson(await this.request("/v2/voices?" + query, { signal }), "voice catalog");
    return {
      voices: (Array.isArray(value?.voices) ? value.voices : []).map(mapVoice),
      hasMore: Boolean(value?.has_more),
      nextPageToken: value?.has_more && typeof value.next_page_token === "string" ? value.next_page_token : null,
      totalCount: Number.isFinite(value?.total_count) ? value.total_count : null
    };
  }

  /** One voice by id, for a voice the user already used. It must belong to the account (My Voices). */
  async getVoice(voiceId, { signal } = {}) {
    const response = await this.request("/v1/voices/" + encodeURIComponent(safeId(voiceId, "voiceId")), { signal });
    return mapVoice(await this.responseJson(response, "voice"));
  }

  /** Text-to-speech models, each marked with whether it advertises `language`. */
  async listModels({ language = "vi", signal } = {}) {
    const requested = languageCode(language);
    const value = await this.responseJson(await this.request("/v1/models", { signal }), "model catalog");
    return (Array.isArray(value) ? value : [])
      .filter((model) => model.can_do_text_to_speech !== false)
      .map((model) => mapModel(model, requested));
  }

  async inspect({ language = "vi", signal } = {}) {
    const requestedLanguage = languageCode(language);
    const [subscriptionResponse, modelsResponse, voiceValues] = await Promise.all([
      this.request("/v1/user/subscription", { signal }),
      this.request("/v1/models", { signal }),
      this.listVoices(requestedLanguage, signal)
    ]);
    const [subscription, modelsValue] = await Promise.all([
      this.responseJson(subscriptionResponse, "subscription"),
      this.responseJson(modelsResponse, "model catalog")
    ]);
    const models = (Array.isArray(modelsValue) ? modelsValue : [])
      .filter((model) => model.can_do_text_to_speech !== false)
      .map((model) => mapModel(model, requestedLanguage));
    const voices = voiceValues.map(mapVoice);
    return {
      status: "connected", requestedLanguage,
      subscription: {
        status: subscription.status ?? null, characterCount: subscription.character_count ?? null,
        characterLimit: subscription.character_limit ?? null,
        canExtendCharacterLimit: subscription.can_extend_character_limit ?? null,
        maxCreditLimitExtension: subscription.max_credit_limit_extension ?? null
      },
      models, voices
    };
  }

  async estimate({ text, modelId, voiceId, language = "vi", voiceSettings, signal }) {
    const requestedLanguage = languageCode(language);
    const catalog = await this.inspect({ language: requestedLanguage, signal });
    const model = catalog.models.find((entry) => entry.modelId === modelId);
    if (!model) throw new ElevenLabsError("Selected ElevenLabs model is not available.", { code: "invalid_input" });
    const voice = catalog.voices.find((entry) => entry.voiceId === voiceId);
    if (!voice) {
      throw new ElevenLabsError("Selected ElevenLabs voice is not available for " + requestedLanguage + ".", {
        code: "invalid_input"
      });
    }
    if (model.supportsRequestedLanguage === false) {
      throw new ElevenLabsError("Selected ElevenLabs model does not advertise support for " + requestedLanguage + ".", {
        code: "invalid_input"
      });
    }
    if (model.canUseStyle === false && voiceSettings?.style > 0) {
      throw new ElevenLabsError("Selected ElevenLabs model does not support style.", { code: "invalid_input" });
    }
    if (model.canUseSpeakerBoost === false && voiceSettings?.use_speaker_boost === true) {
      throw new ElevenLabsError("Selected ElevenLabs model does not support speaker boost.", { code: "invalid_input" });
    }
    const textLength = [...text].length;
    if (Number.isSafeInteger(model.maximumTextLengthPerRequest) &&
        model.maximumTextLengthPerRequest > 0 && textLength > model.maximumTextLengthPerRequest) {
      throw new ElevenLabsError("Text exceeds the selected ElevenLabs model request limit.", { code: "invalid_input" });
    }
    if (model.creditMultiplier === null) {
      throw new ElevenLabsError("Selected ElevenLabs model has no reliable credit multiplier.", {
        code: "approval_limit_unknown"
      });
    }
    const multiplier = model.creditMultiplier;
    // A voice with its own rate can cost more than characters x model multiplier. It stays usable, but the
    // estimate is flagged as not being a ceiling; the provider's real character-cost is recorded after the call.
    const uncertain = voice.customRate !== null;
    return {
      usage: {
        unit: "credits",
        amount: Math.ceil(textLength * multiplier),
        basis: `unicode_characters:${textLength};model_multiplier:${multiplier}` +
          (uncertain ? `;voice_custom_rate:${voice.customRate};estimate_is_not_a_ceiling` : ""),
        ...(uncertain ? { uncertain: true } : {})
      },
      catalog
    };
  }

  async synthesize({
    voiceId, modelId, text, languageCode: language, voiceSettings, outputFormat, seed,
    signal, onProviderResponse
  }) {
    const response = await this.request(
      "/v1/text-to-speech/" + encodeURIComponent(safeId(voiceId, "voiceId")) +
        "?output_format=" + encodeURIComponent(outputFormat),
      {
        method: "POST", signal, submitted: true,
        body: {
          text, model_id: safeId(modelId, "modelId"), language_code: languageCode(language), voice_settings: voiceSettings,
          ...(seed === null ? {} : { seed })
        }
      }
    );
    const characterCostValue = response.headers.get("character-cost");
    const actualCredits = characterCostValue === null ? null : Number(characterCostValue);
    const receipt = {
      actualCredits: Number.isFinite(actualCredits) && actualCredits >= 0 ? actualCredits : null,
      providerRequestId: response.headers.get("request-id"),
      traceId: response.headers.get("x-trace-id")
    };
    if (onProviderResponse) {
      try {
        await onProviderResponse(receipt);
      } catch (error) {
        if (error && typeof error === "object") error.requestSubmitted = true;
        throw error;
      }
    }
    try {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0) throw submittedError("ElevenLabs returned an empty audio response.", "invalid_output");
      return {
        bytes,
        ...receipt
      };
    } catch (error) {
      if (error?.requestSubmitted) throw error;
      throw submittedError("Could not read the ElevenLabs audio response.");
    }
  }
}
