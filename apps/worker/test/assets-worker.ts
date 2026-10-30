export default {
  fetch() {
    return new Response("Protected preview asset", { headers: { "content-type": "text/plain" } });
  },
};
