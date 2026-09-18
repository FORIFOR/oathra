import { defineCallCapability } from '../../sdk/capability-sdk/index.mjs';
export default function create({executeCall}) {
 return defineCallCapability({execute(mission,hooks){if(!executeCall)throw Error('call_executor_not_configured');return executeCall(mission,hooks);}});
}
