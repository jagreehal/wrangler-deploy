export default {
  async fetch(): Promise<Response> {
    return new Response("hello from wrangler-deploy");
  },
};
