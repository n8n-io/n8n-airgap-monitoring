// Fastify's default error body. A route that lists it for a status code gets the same keys
// for its own errors and for schema validation errors (which would otherwise also carry `code`).
export const errorResponseSchema = {
  type: "object",
  required: ["statusCode", "error", "message"],
  properties: {
    statusCode: { type: "integer" },
    error: { type: "string" },
    message: { type: "string" },
  },
};
