export const lovable = {
  auth: {
    signInWithOAuth: async () => {
      return { error: new Error("Authentication is not enabled.") };
    },
  },
};
