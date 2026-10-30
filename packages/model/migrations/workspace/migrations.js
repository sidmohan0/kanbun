import journal from "./meta/_journal.json";
import m0000 from "./0000_marvelous_dark_beast.sql";
import m0001 from "./0001_legal_amphibian.sql";
import m0002 from "./0002_tearful_surge.sql";
import m0003 from "./0003_fresh_khan.sql";
import m0004 from "./0004_modern_machine_man.sql";

export default {
  journal,
  migrations: {
    m0000,
    m0001,
    m0002,
    m0003,
    m0004,
  },
};
