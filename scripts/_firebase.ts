import 'dotenv/config';

/**
 * Is the Firebase project actually set up, or does it only look set up?
 *
 * `make doctor` answers whether the four variables are *present*; this answers
 * whether what they point at exists. The two are different questions and the
 * gap between them is where a whole afternoon goes: a complete-looking `.env`
 * against a project with no Authentication and no database fails at the last
 * possible moment, in a popup, with a code nobody can look up.
 *
 * Read-only, and it signs nobody in. Three public endpoints with the web key —
 * which is public by construction, since it ships in the bundle — and every
 * answer here is one a stranger could get. Nothing is created, and no letter is
 * sent: a probe with a side effect is a probe nobody dares run twice.
 *
 *   pnpm exec tsx scripts/_firebase.ts
 *
 * Run it after setting the project up, and again whenever signing in breaks for
 * no reason anybody can see. Setting the project up: docs/sync.md.
 */

const need = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'];

const ok = (line: string) => console.log(`  ok    ${line}`);
const bad = (line: string) => console.log(`  ——    ${line}`);
const warn = (line: string) => console.log(`  !!    ${line}`);

async function main(): Promise<void> {
  const missing = need.filter((name) => !process.env[name]);
  if (missing.length) {
    bad(`нет в .env: ${missing.join(', ')} — docs/sync.md`);
    process.exitCode = 1;
    return;
  }

  const key = process.env.VITE_FIREBASE_API_KEY!;
  const project = process.env.VITE_FIREBASE_PROJECT_ID!;
  const domain = process.env.VITE_FIREBASE_AUTH_DOMAIN!;

  console.log(`\nпроект ${project}\n`);

  if (domain !== `${project}.firebaseapp.com`) {
    warn(`authDomain ${domain} не собран из id проекта — вход упадёт на auth/unauthorized-domain`);
  }

  // 1. Authentication: enabled at all, and which domains it will answer for.
  const config = await fetch(`https://identitytoolkit.googleapis.com/v1/projects?key=${key}`);
  const body = (await config.json()) as { authorizedDomains?: string[]; error?: { message?: string } };
  if (config.status === 200) {
    const domains = body.authorizedDomains ?? [];
    ok(`Authentication включена`);
    const site = 'lectorea.org';
    if (domains.includes(site)) ok(`${site} в authorized domains`);
    else warn(`${site} НЕ в authorized domains — локально вход будет работать, на проде нет`);
    console.log(`        ${domains.join(', ')}`);
  } else if (String(body.error?.message).includes('CONFIGURATION_NOT_FOUND')) {
    bad('Authentication не включена — Console → Authentication → Get started');
    process.exitCode = 1;
  } else {
    bad(`Authentication: ${config.status} ${body.error?.message ?? ''}`);
    process.exitCode = 1;
  }

  /*
   * 2. Firestore: created, and refusing a stranger.
   *
   * The interesting answer is the *shape* of the refusal. 403 with
   * PERMISSION_DENIED is the rules working. 403 saying the API was never used
   * is a project with no database. And anything that is not a refusal at all —
   * a 200, or a 404 saying only that this document does not exist — means the
   * rules are letting an unauthenticated stranger read the collection, which is
   * every reader's profile.
   */
  const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/profiles/_probe`;
  const store = await fetch(url, { headers: { 'x-goog-api-key': key } });
  const text = await store.text();
  if (store.status === 403 && text.includes('has not been used')) {
    bad('Firestore не создан — Console → Firestore Database → Create database (Native mode)');
    process.exitCode = 1;
  } else if (store.status === 403) {
    ok('Firestore отвечает и правила закрывают чужой профиль');
  } else if (store.status === 404) {
    warn('Firestore пускает неаутентифицированного читателя — правила не те, см. firebase/firestore.rules');
    process.exitCode = 1;
  } else if (store.status === 200) {
    warn('Firestore ОТДАЛ документ без входа — правила открыты, это все профили всех читателей');
    process.exitCode = 1;
  } else {
    bad(`Firestore: ${store.status} ${text.slice(0, 160)}`);
    process.exitCode = 1;
  }

  console.log('');
}

main().catch((error: unknown) => {
  console.error(String((error as Error).message));
  process.exitCode = 1;
});
