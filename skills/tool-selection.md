# Tool selection

1. Read `tool:list` or `tool:recommend`; never infer availability from documentation.
2. Compare only tools for the exact capability. State provider, setup, cost, latency/privacy tradeoff, limitations and required skills.
3. Respect an explicit user preference when it is available. A recommendation is advisory: execution must still name the exact tool.
4. Do not silently fall back. If the chosen tool becomes unavailable or its estimate materially changes, stop and expose the alternatives again.
5. For a paid tool, run planning, check the project budget, obtain exact authorization, then execute once. Preserve provider receipts before local post-processing.
6. If a tool is missing only its API key, send the user to the observer Tools page (`http://127.0.0.1:7603/?panel=tools&tab=voice` for the key and the voice). Never ask for, accept or repeat a key in chat.
7. Read `environment.userServices` in `project:resume`: outside services the user said they have (AI image, video or music generation, paid stock, design tools) and their note. They are options, not PADStudio tools. Propose one only when it serves the brief, agree who operates it, and register each file it produces with `media.register-generated` (provider, model, prompt, rights).

Review the resulting Run/Result and record any material substitution as a Decision.
