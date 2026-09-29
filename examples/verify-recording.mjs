// Run after installing a pinned oathra package in your application:
// node verify-recording.mjs /absolute/path/to/your-transcript-check.json > result.json
// Local evidence checking only: no carrier, network request, approval, or booking.
import { readFileSync } from 'node:fs';
import { verifyTranscript } from 'oathra/evidence';
try {
  if (!process.argv[2]) throw new Error('Pass a transcript-check JSON path (see docs/INTEGRATION.md).');
  const result = verifyTranscript(JSON.parse(readFileSync(process.argv[2], 'utf8')));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.complete ? 0 : 2;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
