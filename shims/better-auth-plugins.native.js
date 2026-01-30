// Native stub for better-auth/plugins
// Provides server-side plugin stubs (should not run on native)

function anonymous() {
  return {
    id: "anonymous",
    endpoints: {},
  };
}

module.exports = {
  anonymous,
  default: { anonymous },
};
module.exports.__esModule = true;
