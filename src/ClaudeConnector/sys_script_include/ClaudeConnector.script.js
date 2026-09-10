/**
 * Script Include: ClaudeConnector
 * Scope: x_ibm_claudeconn
 *
 * Handles:
 *  - Outbound REST calls to the Anthropic Messages API via IBM Services Essentials
 *  - Per-GlideSession conversation history (stored in GlideScopedCache / sys_cache)
 *  - Streaming response via RESTMessageV2 (non-streaming) — ServiceNow does not
 *    support true SSE streaming server-side, so we return the full response and
 *    the client UI simulates a typewriter effect.
 *
 * Equivalent Python routes:  POST /chat   POST /clear
 */
var ClaudeConnector = Class.create();

ClaudeConnector.prototype = {

    initialize: function () {
        this.baseUrl      = gs.getProperty('x_ibm_claudeconn.base_url',   'https://api.servicesessentials.ibm.com');
        this.authToken    = gs.getProperty('x_ibm_claudeconn.auth_token',  '');
        this.defaultModel = gs.getProperty('x_ibm_claudeconn.default_model', 'claude-sonnet-5');
        this.messagesUrl  = this.baseUrl.replace(/\/$/, '') + '/v1/messages';

        this.availableModels = ['claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5'];

        // Conversation cache key prefix — one history list per session
        this.CACHE_PREFIX = 'x_ibm_claudeconn_conv_';
    },

    // -------------------------------------------------------------------------
    // Session helpers — store conversation arrays as JSON in the GlideCache
    // -------------------------------------------------------------------------

    _cacheKey: function (sessionId) {
        return this.CACHE_PREFIX + sessionId;
    },

    getHistory: function (sessionId) {
        var raw = GlideSessionCache.get(this._cacheKey(sessionId));
        if (!raw) return [];
        try { return JSON.parse(raw); } catch (e) { return []; }
    },

    saveHistory: function (sessionId, history) {
        GlideSessionCache.put(this._cacheKey(sessionId), JSON.stringify(history));
    },

    clearHistory: function (sessionId) {
        GlideSessionCache.put(this._cacheKey(sessionId), '[]');
    },

    // -------------------------------------------------------------------------
    // Chat — mirrors the Flask POST /chat route
    //
    // params: {
    //   prompt         : string  (required)
    //   session_id     : string  (required — caller passes gs.getSessionID())
    //   model          : string  (optional)
    //   system_prompt  : string  (optional)
    //   prefill        : string  (optional)
    //   stop_sequences : string  (optional, comma-separated)
    // }
    //
    // Returns: {
    //   success : boolean
    //   text    : string   (full assistant reply)
    //   model   : string
    //   usage   : { input_tokens, output_tokens }
    //   error   : string   (only on failure)
    // }
    // -------------------------------------------------------------------------

    chat: function (params) {
        var prompt       = (params.prompt        || '').trim();
        var sessionId    = params.session_id     || 'anonymous';
        var model        = (params.model         || this.defaultModel).trim();
        var systemPrompt = (params.system_prompt || '').trim();
        var prefill      = (params.prefill       || '').trim();
        var stopRaw      = (params.stop_sequences || '').trim();

        if (!prompt) {
            return { success: false, error: 'Prompt cannot be empty.' };
        }

        if (this.availableModels.indexOf(model) === -1) {
            model = this.defaultModel;
        }

        var stopSequences = [];
        if (stopRaw) {
            var parts = stopRaw.split(',');
            for (var i = 0; i < parts.length; i++) {
                var s = parts[i].trim();
                if (s) stopSequences.push(s);
            }
        }

        // Build user content — mirror prefill behaviour from Python app
        var userContent = prompt;
        if (prefill) {
            userContent = prompt + '\n\nRespond starting with: ' + prefill;
        }

        var history = this.getHistory(sessionId);
        history.push({ role: 'user', content: userContent });

        var payload = {
            model:      model,
            max_tokens: 4096,
            messages:   history
        };
        if (systemPrompt) payload.system = systemPrompt;
        if (stopSequences.length) payload.stop_sequences = stopSequences;

        // Log request (mirrors Python print statements)
        gs.info('[ClaudeConnector] [REQUEST] session=' + sessionId.substring(0, 8) +
                '... turns=' + history.length + ' model=' + model);
        gs.info('[ClaudeConnector] [REQUEST] prompt=' + prompt.substring(0, 120));

        try {
            var rm = new sn_ws.RESTMessageV2();
            rm.setEndpoint(this.messagesUrl);
            rm.setHttpMethod('POST');
            rm.setRequestHeader('x-api-key',          this.authToken);
            rm.setRequestHeader('anthropic-version',   '2023-06-01');
            rm.setRequestHeader('content-type',        'application/json');
            rm.setRequestBody(JSON.stringify(payload));
            rm.setMutualAuth(false);
            rm.setEccParameter('skip_sensor', 'true');

            var response   = rm.execute();
            var statusCode = response.getStatusCode();
            var body       = response.getBody();

            gs.info('[ClaudeConnector] [RESPONSE] status=' + statusCode);

            if (statusCode < 200 || statusCode >= 300) {
                gs.error('[ClaudeConnector] [ERROR] ' + body);
                return { success: false, error: 'API error ' + statusCode + ': ' + body };
            }

            var parsed;
            try { parsed = JSON.parse(body); } catch (e) {
                return { success: false, error: 'Failed to parse API response: ' + body.substring(0, 200) };
            }

            // Extract text from content blocks
            var assistantText = '';
            var contentBlocks = parsed.content || [];
            for (var j = 0; j < contentBlocks.length; j++) {
                if (contentBlocks[j].type === 'text') {
                    assistantText += contentBlocks[j].text;
                }
            }

            var usage      = parsed.usage || {};
            var modelUsed  = parsed.model || model;

            gs.info('[ClaudeConnector] [TOKENS] input=' + usage.input_tokens +
                    ' output=' + usage.output_tokens);
            gs.info('[ClaudeConnector] [RESPONSE] model=' + modelUsed);

            // Persist history
            history.push({ role: 'assistant', content: assistantText });
            this.saveHistory(sessionId, history);
            gs.info('[ClaudeConnector] [HISTORY] saved ' + history.length +
                    ' messages for session ' + sessionId.substring(0, 8) + '...');

            // JSON extraction when prefill was used (mirrors Python logic)
            var jsonResult = null;
            if (prefill) {
                try {
                    var stripped = assistantText.trim();
                    if (stripped.indexOf('```') === 0) {
                        var lines = stripped.split('\n');
                        lines.shift(); // remove opening fence
                        if (lines[lines.length - 1].trim() === '```') lines.pop();
                        stripped = lines.join('\n').trim();
                    }
                    jsonResult = JSON.parse(stripped);
                } catch (e) { /* not JSON — skip */ }
            }

            return {
                success:     true,
                text:        assistantText,
                model:       modelUsed,
                usage:       { input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0 },
                json_result: jsonResult ? JSON.stringify(jsonResult, null, 2) : null
            };

        } catch (e) {
            gs.error('[ClaudeConnector] [EXCEPTION] ' + e.message);
            return { success: false, error: e.message };
        }
    },

    // -------------------------------------------------------------------------
    // Clear — mirrors Flask POST /clear
    // -------------------------------------------------------------------------
    clear: function (sessionId) {
        this.clearHistory(sessionId);
        gs.info('[ClaudeConnector] [CLEAR] session=' + sessionId.substring(0, 8) + '...');
        return { success: true, status: 'cleared' };
    },

    type: 'ClaudeConnector'
};
