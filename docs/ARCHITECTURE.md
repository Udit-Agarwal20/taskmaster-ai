# Taskmaster Architecture

```text
User
  |
  v
Next.js / React
  |                \
  |                 -> Agent API on Cloud Run
  v                           |
Zero Sync                      v
  |                       Google ADK
  v                           |
PostgreSQL                Gemini 3.5 Flash
                              |
                         Typed Tool Layer
                              |
                 +------------+------------+
                 |                         |
             Safe actions             Approval
                 |                         |
                 +------------+------------+
                              |
                              v
                         PostgreSQL
                              |
                           Pub/Sub
                              |
                         Cloud Run worker
```

## Trust boundary
The model never receives unrestricted database access. Every mutation is a typed tool call checked by schema validation, authorization, risk policy, optional approval, and postcondition verification.
