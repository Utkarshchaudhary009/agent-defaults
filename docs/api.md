# API Reference

All endpoints live under the versioned root of this service. Clients use the API contract below, not any database schema.

## Error Convention

Every non-2xx response is JSON with a stable, machine-readable shape:

```json
{
  "error": {
    "code": "<STABLE_CODE>",
    "message": "<human-readable detail>"
  }
}
```

| Status | Code | Meaning |
| --- | --- | --- |
| 404 | `NOT_FOUND` | The requested resource does not exist |
| 500 | `INTERNAL_SERVER_ERROR` | Unexpected server failure |

## Endpoints

### `GET /health`

Liveness probe for load balancers and orchestration.

**Response** `200 OK`:

```json
{ "status": "ok" }
```

Example:

```sh
curl -s http://127.0.0.1:3000/health
# -> {"status":"ok"}
```
