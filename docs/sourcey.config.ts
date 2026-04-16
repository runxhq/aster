export default {
  name: "automaton",
  repo: "https://github.com/nilstate/automaton",
  editBranch: "main",
  editBasePath: "docs",
  theme: {
    preset: "default",
    colors: {
      primary: "#0f766e",
      light: "#14b8a6",
      dark: "#115e59",
    },
    fonts: {
      sans: "'IBM Plex Sans', sans-serif",
      mono: "'IBM Plex Mono', monospace",
    },
  },
  navigation: {
    tabs: [
      {
        tab: "Automaton",
        groups: [
          {
            group: "Start",
            pages: ["introduction", "philosophy", "dogfood", "evolution"],
          },
          {
            group: "Operate",
            pages: ["operating-model", "flows", "skill-contribution", "operations"],
          },
          {
            group: "Reference",
            pages: ["run-catalog", "backlog"],
          },
        ],
      },
    ],
  },
  navbar: {
    links: [
      {
        type: "github",
        href: "https://github.com/nilstate/automaton",
      },
    ],
    primary: {
      type: "button",
      label: "View Repo",
      href: "https://github.com/nilstate/automaton",
    },
  },
  footer: {
    links: [
      {
        type: "github",
        href: "https://github.com/nilstate/automaton",
      },
    ],
  },
  search: {
    featured: ["introduction", "philosophy", "evolution"],
  },
};
