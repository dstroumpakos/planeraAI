// Stub for better-auth migrations
module.exports = {};
module.exports.default = {};
module.exports.__esModule = true;
module.exports.runMigrations = async () => ({ success: true, migrations: [] });
module.exports.getMigrations = async () => [];
module.exports.createMigration = async () => null;
module.exports.migrateDatabase = async () => ({ success: true });
module.exports.getMigrationStatus = async () => ({ pending: [], applied: [] });
module.exports.createInternalAdapter = () => ({});
module.exports.internalAdapter = {};
