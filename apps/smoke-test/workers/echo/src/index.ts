export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    return new Response(`echo: ${url.pathname}`);
  },
};
