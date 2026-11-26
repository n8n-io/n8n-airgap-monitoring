import { CreateInstanceReports1788912000000 } from "./1788912000000-CreateInstanceReports";
import { AddConsumerIdToInstanceReports1795132800000 } from "./1795132800000-AddConsumerIdToInstanceReports";
import { CreateReportSubmissions1792022400000 } from "./1792022400000-CreateReportSubmissions";

/**
 * Every migration, oldest first.
 * Add a new migration by creating its file and appending the class here.
 */
export const migrations = [CreateInstanceReports1788912000000, AddConsumerIdToInstanceReports1795132800000,CreateReportSubmissions1792022400000];
