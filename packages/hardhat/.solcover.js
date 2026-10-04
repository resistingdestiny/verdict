// solidity-coverage: measure Verdict, VerdictRouter and the resolvers only. Mocks are test scaffolding;
// interfaces and the code library hold no executable lines.
module.exports = {
  skipFiles: ["mocks", "interfaces", "libraries"],
  istanbulReporter: ["text", "text-summary"],
  mocha: {
    timeout: 600000,
  },
};
