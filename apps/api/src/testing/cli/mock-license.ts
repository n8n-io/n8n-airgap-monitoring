// Development CLI. Mints mock license certificates that only a receiver
// running with NODE_ENV=test and TEST_LICENSE_ISSUER_CERT trusts; a
// production-mode receiver rejects every one of them.
//
//   mock-license ca --out DIR              write a fresh CA (ca.key.pem, ca.cert.pem)
//   mock-license cert --ca DIR [--expired] print a license container signed by that CA
import { parseArgs } from "node:util";
import { readDevCa, writeDevCa } from "../dev-ca.ts";
import { generateMockLicense } from "../mock-license.ts";

const USAGE = `usage:
  mock-license ca --out DIR              write a fresh dev CA into DIR
  mock-license cert --ca DIR [--expired] print a license certificate signed by the CA in DIR`;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    ca: { type: "string" },
    expired: { type: "boolean", default: false },
  },
});

switch (positionals[0]) {
  case "ca": {
    if (!values.out) fail(USAGE);
    writeDevCa(values.out);
    process.stderr.write(`wrote dev CA to ${values.out}\n`);
    break;
  }
  case "cert": {
    if (!values.ca) fail(USAGE);
    process.stdout.write(generateMockLicense({ ca: readDevCa(values.ca), expired: values.expired }));
    break;
  }
  default:
    fail(USAGE);
}
