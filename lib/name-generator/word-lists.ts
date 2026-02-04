/**
 * Curated word lists for deterministic name generation.
 *
 * Three categories of ~250 words each, mixing Bitcoin/crypto themes
 * with whimsical, memorable vocabulary. All words are lowercase
 * and formatted by the generator.
 */

/** Descriptive words -- first component of generated names */
export const ADJECTIVES = [
  // crypto / tech
  "atomic", "binary", "cyber", "digital", "encrypted", "fractal",
  "galactic", "hashed", "ionic", "joined", "keyed", "linked",
  "merged", "nested", "onchain", "parallel", "quantum", "recursive",
  "synced", "trustless", "unified", "verified", "wired", "xored",

  // cosmic / space
  "astral", "blazing", "celestial", "cosmic", "dark", "eclipse",
  "flaring", "glowing", "halcyon", "infinite", "jovian", "kinetic",
  "lunar", "martian", "nebular", "orbital", "photon", "quasar",
  "radiant", "solar", "stellar", "thermal", "ultraviolet", "void",

  // colors / materials
  "amber", "azure", "bronze", "cobalt", "coral", "crimson",
  "crystal", "diamond", "emerald", "golden", "graphite", "indigo",
  "iron", "ivory", "jade", "marble", "neon", "obsidian",
  "onyx", "opal", "pearl", "platinum", "ruby", "sapphire",
  "scarlet", "silver", "steel", "titanium", "topaz", "violet",

  // intensity / speed
  "blazing", "bold", "brisk", "charged", "dashing", "eager",
  "fierce", "flash", "flying", "furious", "hasty", "hyper",
  "keen", "lightning", "lively", "mega", "nimble", "phantom",
  "prime", "quick", "rapid", "rushing", "sharp", "silent",
  "sleek", "snappy", "sonic", "speedy", "stark", "steady",
  "stealthy", "stormy", "super", "swift", "turbo", "ultra",
  "vivid", "wild", "zappy", "zippy",

  // personality / nature
  "ancient", "arcane", "austere", "brave", "bright", "calm",
  "clever", "cold", "cool", "crafty", "cunning", "daring",
  "deep", "devoted", "eager", "elegant", "eternal", "fair",
  "fearless", "feral", "fiery", "firm", "floating", "fluid",
  "frosty", "gentle", "ghostly", "grim", "gusty", "hardy",
  "hollow", "humble", "icy", "inner", "keen", "kind",
  "lasting", "lean", "light", "lone", "lost", "lucid",
  "luminous", "mighty", "misty", "modest", "mystic", "noble",
  "odd", "pale", "patient", "polar", "proud", "pure",
  "quiet", "rare", "regal", "rising", "roaming", "rough",
  "royal", "rugged", "sacred", "sage", "savage", "secret",
  "serene", "shining", "sly", "sober", "solemn", "somber",
  "spare", "spectral", "spiral", "stable", "stoic", "strange",
  "subtle", "tidal", "true", "twilight", "twin", "valiant",
  "vast", "veiled", "vigilant", "wandering", "warm", "watchful",
  "woven", "young", "zealous", "zen",

  // size / shape
  "broad", "compact", "dense", "dual", "giant", "grand",
  "half", "heavy", "hex", "hollow", "huge", "jagged",
  "lean", "little", "long", "micro", "mini", "narrow",
  "round", "small", "solid", "tall", "thin", "tiny",
  "triple", "vast", "wide",
] as const;

/** Creature / object words -- second component of generated names */
export const NOUNS = [
  // animals
  "badger", "bear", "bison", "bobcat", "bull", "cobra",
  "condor", "cougar", "crane", "crow", "deer", "dolphin",
  "dragon", "eagle", "elk", "falcon", "ferret", "finch",
  "fox", "frog", "gecko", "goat", "gorilla", "gryphon",
  "gull", "hawk", "heron", "horse", "hound", "jaguar",
  "jay", "kite", "lark", "lemur", "leopard", "lion",
  "lizard", "lynx", "mantis", "marten", "moose", "moth",
  "narwhal", "newt", "octopus", "orca", "osprey", "otter",
  "owl", "ox", "panda", "panther", "parrot", "pelican",
  "penguin", "pike", "puma", "python", "quail", "rabbit",
  "ram", "raptor", "raven", "robin", "salmon", "scorpion",
  "shark", "shrike", "snipe", "sparrow", "sphinx", "squid",
  "stag", "stallion", "stork", "swallow", "swan", "swift",
  "tiger", "toad", "tortoise", "trout", "turtle", "viper",
  "vulture", "walrus", "wasp", "whale", "wolf", "wren",

  // mythical / legendary
  "basilisk", "centaur", "chimera", "djinn", "fenrir", "garuda",
  "golem", "griffin", "hydra", "kraken", "leviathan", "manticore",
  "minotaur", "naga", "pegasus", "phoenix", "roc", "seraph",
  "sprite", "sylph", "titan", "troll", "unicorn", "valkyrie",
  "warden", "wyvern", "yeti", "zephyr",

  // tech / objects
  "anvil", "arc", "beacon", "blade", "bolt", "bridge",
  "cache", "cannon", "capsule", "castle", "chain", "circuit",
  "citadel", "clock", "comet", "compass", "core", "crest",
  "crystal", "cube", "cypher", "dome", "drill", "drone",
  "dynamo", "engine", "flare", "forge", "gate", "gear",
  "globe", "hammer", "harp", "helix", "hub", "key",
  "lance", "laser", "lattice", "ledger", "lens", "lock",
  "loom", "mast", "matrix", "mirror", "monolith", "nexus",
  "node", "obelisk", "orb", "orbit", "piston", "pixel",
  "portal", "prism", "probe", "pulse", "reactor", "relay",
  "rocket", "router", "rune", "saber", "sail", "satellite",
  "scepter", "scroll", "seed", "sentinel", "shard", "shield",
  "signal", "socket", "spark", "spire", "spoke", "spring",
  "stamp", "star", "stone", "summit", "sword", "temple",
  "throne", "torch", "tower", "trident", "turbine", "vault",
  "vector", "vertex", "vortex", "wand",
] as const;

/** Action / title words -- third component of generated names */
export const EPITHETS = [
  // actions / verbs (gerund-style)
  "breaker", "builder", "burner", "caller", "carver", "caster",
  "charger", "chaser", "climber", "coder", "crafter", "crosser",
  "crusher", "dancer", "darter", "dasher", "dealer", "delver",
  "digger", "diver", "drifter", "driver", "fencer", "finder",
  "flier", "forger", "founder", "gazer", "glider", "grinder",
  "guard", "guide", "hacker", "handler", "hauler", "healer",
  "herald", "holder", "hooker", "hunter", "jumper", "keeper",
  "lancer", "launcher", "leader", "leaper", "lifter", "linker",
  "listener", "maker", "mapper", "marcher", "mender", "miner",
  "mixer", "molder", "mover", "opener", "packer", "painter",
  "parser", "patcher", "pacer", "pilot", "planner", "player",
  "plunger", "prover", "puller", "pusher", "racer", "raider",
  "ranger", "reader", "reaper", "render", "rider", "rigger",
  "roamer", "roller", "rover", "runner", "rusher", "sailor",
  "saver", "scaler", "scout", "seeker", "sender", "setter",
  "shaker", "shaper", "shifter", "signer", "singer", "skater",
  "slinger", "smasher", "solver", "sorter", "sparker", "speaker",
  "spinner", "splitter", "sprinter", "stacker", "stalker", "starter",
  "stepper", "stoker", "strider", "striker", "surfer", "sweeper",
  "swimmer", "swinger", "tacker", "tamer", "thinker", "tracker",
  "trader", "tracer", "trainer", "trapper", "trekker", "turner",
  "twister", "vaulter", "viewer", "walker", "wanderer", "watcher",
  "weaver", "welder", "wielder", "worker", "wrapper", "writer",

  // titles / roles
  "ace", "agent", "alchemist", "anchor", "apprentice", "arbiter",
  "archer", "artisan", "baron", "bishop", "captain", "centurion",
  "champion", "chancellor", "chief", "commander", "consul", "corsair",
  "count", "crusader", "curator", "czar", "deacon", "delegate",
  "deputy", "duke", "elder", "emissary", "envoy", "expert",
  "general", "governor", "guardian", "guru", "herald", "hermit",
  "icon", "judge", "jurist", "king", "knight", "legate",
  "lord", "maestro", "magus", "marshal", "master", "mentor",
  "mystic", "noble", "nomad", "oracle", "paladin", "patriarch",
  "pioneer", "prefect", "priest", "prince", "prophet", "protector",
  "queen", "rector", "regent", "sage", "samurai", "scholar",
  "scribe", "senator", "shaman", "sheriff", "shogun", "sovereign",
  "squire", "steward", "sultan", "templar", "tribune", "vanguard",
  "vicar", "viking", "vizier", "warden", "wizard",
] as const;

/** Total combination count for reference */
export const TOTAL_COMBINATIONS =
  ADJECTIVES.length * NOUNS.length * EPITHETS.length;
