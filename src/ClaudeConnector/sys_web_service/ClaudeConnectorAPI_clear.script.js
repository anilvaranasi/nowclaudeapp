(function process(/*RESTAPIRequest*/ request, /*RESTAPIResponse*/ response) {

    var connector = new x_ibm_claudeconn.ClaudeConnector();
    var sessionId = gs.getSessionID();
    var result    = connector.clear(sessionId);

    response.setStatus(200);
    response.setBody(result);

})(request, response);
