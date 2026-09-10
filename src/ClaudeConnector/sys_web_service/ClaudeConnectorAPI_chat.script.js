/**
 * Scripted REST API Resource: ClaudeConnectorAPI
 * Scope : x_ibm_claudeconn
 *
 * Base path : /api/x_ibm_claudeconn/claude
 *
 * Resources
 * ---------
 *  POST /chat   — send a message, get full response (replaces Flask POST /chat)
 *  POST /clear  — clear conversation history     (replaces Flask POST /clear)
 *  GET  /models — list available models
 *
 * The client-side JS in the UI Page / SP Widget calls these endpoints via
 * XMLHttpRequest and simulates a typewriter streaming effect on the response.
 */

(function process(/*RESTAPIRequest*/ request, /*RESTAPIResponse*/ response) {

    var connector = new x_ibm_claudeconn.ClaudeConnector();
    var sessionId = gs.getSessionID();

    /* ---- POST /chat ---- */
    if (request.getRequestMethod() === 'POST') {

        var body;
        try { body = request.body.data; } catch (e) { body = {}; }

        var result = connector.chat({
            prompt:         body.prompt         || '',
            session_id:     sessionId,
            model:          body.model          || '',
            system_prompt:  body.system_prompt  || '',
            prefill:        body.prefill        || '',
            stop_sequences: body.stop_sequences || ''
        });

        if (result.success) {
            response.setStatus(200);
            response.setBody(result);
        } else {
            response.setStatus(400);
            response.setBody({ error: result.error });
        }
    }

})(request, response);
