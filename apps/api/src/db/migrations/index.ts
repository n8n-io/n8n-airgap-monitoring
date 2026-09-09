import { CreateInstanceReports1788912000000 } from "./1788912000000-CreateInstanceReports";

/**
 * Every migration, oldest first. Listed explicitly rather than discovered by
 * glob so the compiled image needs no file lookup and no TypeORM CLI: add a
 * new migration by creating its file and appending the class here.
 */
export const migrations = [CreateInstanceReports1788912000000];
