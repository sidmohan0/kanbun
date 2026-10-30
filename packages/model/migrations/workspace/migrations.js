import journal from "./meta/_journal.json";
import m0000 from "./0000_marvelous_dark_beast.sql";
import m0001 from "./0001_legal_amphibian.sql";
import m0002 from "./0002_tearful_surge.sql";

export default {
  journal,
  migrations: {
    m0000,
    m0001,
    m0002,
  },
};
