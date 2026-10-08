// fact: a commit description opens with one of these verbs, or re-, un-, de- or pre- and one of them
// fact: one list for every repository the commit gate serves; a missing verb is added here
const WORDS = `
abandon abbreviate abort absorb abstract accept access accommodate account accumulate achieve ack
acknowledge acquire act activate adapt add address adjudicate adjust admit adopt advance advertise
advise affect affirm aggregate alias align allocate allow allowlist alter amend analyse analyze
anchor animate annotate announce anonymise anonymize answer anticipate append apply approve
approximate arbitrate archive argue arm arrange ask assemble assert assess assign assist associate
assume attach attack attempt attend attest attribute audit augment authenticate author authorise
authorize autodetect automate avoid await back backfill backlog backport bake balance ban bank
base baseline batch become begin benchmark bias bind bisect blacklist blank blend block blocklist
blur boost boot bootstrap borrow bound box branch break bring broaden browse buffer build bump
bundle bypass cache calculate calibrate call cancel cap capitalise capitalize capture carry
cascade cast catalogue catch categorise categorize cause centralise centralize centre certify
chain challenge change channel characterise characterize charge chart check checkpoint cherry-pick
choose chunk cite claim clamp clarify classify clean cleanse clear click clip clone close cluster
coalesce code coerce collapse collate collect colour combine comment commit compact compare
compile complete comply compose compress compute concatenate condense configure confine confirm
conform connect consider consolidate constrain construct consult consume contain continue contrast
contribute control convert convey coordinate copy correct correlate count couple cover crash
create credit crop cross cross-check cross-reference cull curate cut date deactivate deal debounce
debug decide declare decline decode decommission decompose decorate decouple decrease decrypt
dedent dedupe deduplicate deep-link deepen default defend defer define deflake delay delegate
delete deliver demangle demonstrate demote denote deny denylist deploy deprecate dereference
derive describe deserialise deserialize design designate destroy detach detect determine develop
diagnose diff differentiate dim direct disable disallow disambiguate disarm discard disclose
disconnect discount discover discuss disentangle dismiss dispatch display dispose distinguish
distribute divide do dockerise dockerize document double double-check downgrade download downscale
draft drag drain draw drive drop dry-run dump duplicate ease echo edit eject elaborate elevate
elide eliminate embed emit empty emulate enable encapsulate enclose encode encourage encrypt end
endorse enforce engage enhance enlarge enqueue enrich enrol enroll ensure enter enumerate equalise
equalize equip erase escalate escape establish estimate evaluate evict exact examine exceed excise
exclude exec execute exempt exercise exhaust exit expand expect expedite expire explain explore
export expose express extend externalise externalize extract fabricate facilitate factor fail fake
fall fan fast-forward feed fence fetch fill filter finalise finalize find fine-tune finish fire
fit fix flag flatten flip float flow flush focus fold follow forbid force forecast forget fork
format forward frame free freeze fulfil fulfill fuse fuzz gain garbage-collect gate gather gauge
generalise generalize generate get give glob glue go grade graft grant graph grep greylist group
grow guarantee guard guess guide gzip halt halve hand handle hang hard-code hardcode harden
harmonise harmonize harvest hash heal hide highlight hint hoist hold honor honour hook host
hot-reload hotfix hydrate identify ignore illustrate implement import impose improve include
incorporate increase increment indent index indicate infer inform ingest inherit initialise
initialize inject inline insert inspect install instantiate instruct instrument integrate
intercept interleave internalise internalize interpolate interpret interrupt introduce invalidate
invert investigate invite invoke isolate issue itemise itemize iterate join judge jump justify
keep key kick kill label launch layer lazy-load lead learn lease leave lengthen let level license
lift limit link lint list listen load localise localize locate lock log look loop loosen lower
lowercase maintain make manage mandate map mark mask match materialise materialize maximise
maximize measure memoise memoize mention merge migrate mimic minify minimise minimize mint mirror
mitigate mix mock model moderate modernise modernize modify monitor mount move multiply mute name
narrow navigate negate negotiate nest normalise normalize notarise notarize note notify nudge
nullify number obey obfuscate observe obtain obviate offer offload omit onboard open operate
optimise optimize order organise organize orient outline output overhaul overlay override
overwrite own pace pack package pad page paginate paint pair parallelise parallelize parameterise
parameterize parenthesise parse partition pass paste patch pause penalise penalize perform permit
persist pick pin pipe pivot place plan plant play plot plug pluralise pluralize point polish poll
populate port position post postpone pre-compute precompute predict prefer prefix preload prepare
prepend present preserve press prettify prevent preview prime print prioritise prioritize probe
proceed process produce profile program project promote prompt propagate propose protect prove
provide provision proxy prune pseudonymise pseudonymize publish pull purge push put qualify
quantify quarantine query question queue quiesce quiet quote raise randomise randomize rank
ratchet rate rate-limit re-enable reach react read realign reap rearrange reason reassign
rebalance rebase reboot rebuild recalculate receive recognise recognize recommend reconcile
reconstruct record recover recreate rectify recurse redact redeploy redesign redirect redistribute
redo reduce refactor refer refine reflect reflow reformat refresh refuse regenerate register
regress regroup reindex reinstate reject relabel relax release relink reload relocate remap
remediate remember remind remove rename render renew renumber reopen reorder reorganise reorganize
repair repeat rephrase replace replay reply report represent reproduce request require rerun
reschedule rescue reserve reset reshape resize resolve respect respond restart restore restrict
restructure resume retag retain retire retract retrieve retry return reuse reveal reverse revert
review revise revoke rewire reword rewrite roll rotate round round-trip route run salt salvage
sample sandbox sanitise sanitize sanity-check save say scaffold scale scan schedule scope score
scrape screen script scrub seal search secure see seed seek segment select self-host send separate
sequence serialise serialize serve set settle shadow shard share sharpen shed shift shim ship
short-circuit shorten show shrink shuffle shut sidestep sign signal silence simplify simulate sink
size skip slice slim slot slow smoke-test smooth snap snapshot sniff snooze soft-delete soften
solve sort source space span spawn specialise specialize specify speed spell spellcheck spill spin
split spot spot-check spread square squash stabilise stabilize stack stage stall stamp standardise
standardize start stash state stay steer step stick stop store straighten stream streamline
strengthen stress stretch strike string strip structure stub style submit subscribe substitute
subsume subtract succeed suggest summarise summarize sunset supersede supply support suppress
surface survive suspend swap sweep switch symlink sync synchronise synchronize synthesise
synthesize tabulate tag tailor take tally tar target teach tear tee tell template terminate test
thin thread throttle throw tick tidy tie tighten time timestamp toggle tokenise tokenize tolerate
touch trace track train transcribe transfer transform translate transmit transpile traverse treat
triage trigger trim truncate trust try tune tunnel turn tweak type typecheck unblock uncomment
underline understand undo unescape unfold unify uninstall unite unlink unlock unmount unpack unpin
unregister unset unskip unstage unsubscribe untag untangle unwrap update upgrade upload uppercase
upscale upsert upstream use validate vary vendor verify version vet view visit visualise visualize
wait wake walk warm warn watch weaken weigh weight whitelist widen wind wipe wire withdraw word
work wrap write write-protect yank yield zero zip zoom
`;

export const IMPERATIVE_VERBS = new Set(WORDS.split(/\s+/).filter(Boolean));
