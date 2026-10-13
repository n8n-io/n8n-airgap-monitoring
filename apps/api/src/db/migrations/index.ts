import { CreateInstanceReports1788912000000 } from "./1788912000000-CreateInstanceReports";
import { AddConsumerIdToInstanceReports1791504000000 } from "./1791504000000-AddConsumerIdToInstanceReports";

/**
 * Every migration, oldest first.
 * Add a new migration by creating its file and appending the class here.
 */
export const migrations = [CreateInstanceReports1788912000000, AddConsumerIdToInstanceReports1791504000000];
