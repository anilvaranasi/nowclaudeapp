---
name: servicenow-verify
description: Use when verifying, checking, or testing a ServiceNow scoped app — covers app configuration, table/field setup, roles, ACLs, REST API testing, and live data checks against the instance.
---

# ServiceNow App Verification

Follow these rules every time you need to verify, check, or test anything in the ServiceNow scoped app.

## Source-of-truth rules

| What you are checking | Where to look |
|---|---|
| App configuration (tables, fields, ACLs, roles, REST API definitions, script includes, properties) | **Workspace XML files** in the scoped app folder (e.g. `05405d7893df8310945375dcebba109b/update/`) — this is the authoritative source, never guess |
| Foundation data (users, groups, group members, roles, role assignments, sys_properties) | **REST API call** to the live instance |
| Transactional / business data (records in custom tables, incidents, requests, etc.) | **REST API call** to the live instance |

**Never** call the REST API to verify something that is defined in the workspace XML files.  
**Never** read workspace XML to check live data that only exists on the instance.

## Step 1 — Read instance credentials

Read `config.env` in the workspace root to get:
- `SN_INSTANCE` — base URL (e.g. `https://dev224768.service-now.com`)
- `SN_USER` — username
- `SN_PASSWORD` — password

Build a Basic Auth header:
```powershell
$creds = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("$SN_USER:$SN_PASSWORD"))
$headers = @{ "Authorization" = "Basic $creds"; "Accept" = "application/json" }
```

## Step 2 — Determine the correct table name

Tables defined in a scoped app are **prefixed with the app scope**.  
The scope is found in `sys_app_<id>.xml` under the `<scope>` element (e.g. `x_146833_claudec_0`).

**Scoped table naming rule:**
- Dictionary element name in XML: `u_it_system`
- Actual REST API table name: `x_146833_claudec_0_u_it_system`

Always apply `<scope>_<table_element_name>` when building REST API URLs for scoped tables.

## Step 3 — App configuration checks (workspace files)

To verify tables, fields, choices, roles, ACLs, REST API definitions:

1. Use `grep` or `read_file` on the XML files in the scoped app `update/` folder
2. Parse the relevant `sys_dictionary`, `sys_db_object`, `sys_user_role`, `sys_security_acl`, `sys_ws_definition`, `sys_ws_operation` files
3. Never make a REST API call for this — the XML is the ground truth

Key file naming conventions:
- Table: `sys_db_object_<table_name>.xml`
- Field: `sys_dictionary_<table_name>_<field_name>.xml`
- Choice: `sys_choice_<table_name>_<field_name>.xml`
- Role: `sys_user_role_<sys_id>.xml`
- ACL: `sys_security_acl_<table>_<operation>.xml`
- REST API: `sys_ws_definition_*.xml`, `sys_ws_operation_*.xml`
- Number: `sys_number_<table_name>.xml`

## Step 4 — Foundation data checks (REST API)

Use the ServiceNow Table API for:
- Users: `GET /api/now/table/sys_user?sysparm_query=user_name=<name>&sysparm_fields=name,user_name,roles`
- Groups: `GET /api/now/table/sys_user_group?sysparm_query=name=<name>&sysparm_fields=name,manager`
- Group members: `GET /api/now/table/sys_user_grmember?sysparm_query=group.name=<name>&sysparm_fields=user.name,user.user_name`
- Role assignments: `GET /api/now/table/sys_user_has_role?sysparm_query=user.user_name=<name>&sysparm_fields=role.name`
- Properties: `GET /api/now/table/sys_properties?sysparm_query=name=<prop_name>&sysparm_fields=name,value`

Always include `sysparm_fields` to limit the response to relevant columns.

## Step 5 — Transactional / business data checks (REST API)

Use the Table API with the **scoped table name**:
```
GET /api/now/table/x_146833_claudec_0_u_it_system?sysparm_limit=10&sysparm_fields=u_number,u_project_name,u_operational_status
```

For inserting test records:
```
POST /api/now/table/x_146833_claudec_0_u_it_system
Body: { "u_project_name": "Test", "u_active": "true" }
```

## Step 6 — Interpret HTTP responses

| Status | Meaning |
|---|---|
| 200 / 201 | Success — parse `result` array/object |
| 400 | Bad request — table name wrong, field doesn't exist on instance, or update set not applied |
| 401 | Auth failed — check credentials in config.env |
| 403 | Access denied — check ACLs and role grants for the calling user |
| 404 | Table or record not found — update set likely not applied to instance |

If you get a **400 with empty body** or **404**, first check whether the update set has been applied to the instance before debugging further.

## Step 7 — Report findings clearly

Always report:
1. What you checked and where (workspace file path OR REST API endpoint)
2. The result (field type, value, HTTP status, record count, etc.)
3. Whether it matches the expected configuration
4. Any gaps or mismatches with a clear recommendation
