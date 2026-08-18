import { ANALYTICS_PARAMS } from '../shared/analytics.js';
import { adminApi, type Admin } from './lib/ga.js';
import { reportRunError } from './lib/exit.js';

/**
 * Bringing the GA4 property in line with what the site actually sends.
 *
 * The half of an analytics setup that is invisible until it is missing: GA4
 * accepts any parameter on any event and stores it, and then offers **none of
 * them** in a report unless a custom dimension or metric has been registered
 * for that exact name. Events arrive, the totals go up, and the breakdown the
 * event was added for is simply not in the menu — a month later, when somebody
 * goes looking, the data for that month cannot be recovered.
 *
 * So the registry in `shared/analytics.ts` is the source and this is the tool
 * that makes the property match it. It is idempotent: it reads what is there,
 * creates what is missing, and says what it did. Run it after adding an event.
 *
 * ```bash
 * pnpm ga4:setup              # what is there, and what is missing
 * pnpm ga4:setup --apply      # create the missing dimensions and metrics
 * ```
 *
 * Nothing is written without `--apply`, like every other script here that can
 * change something outside the repository.
 *
 * **Access.** The service account in `keys/ga4-admin.json` has to be given
 * administrator rights on the analytics *account* by hand, in the interface —
 * a service account cannot be granted them by an API it has no rights on yet,
 * and an analytics account cannot be created by an API at all. The script says
 * so plainly when it finds nothing, because the empty answer is otherwise
 * indistinguishable from a property with nothing in it.
 */

/** The stream the site reports to. Overridden with `--id=`. */
const MEASUREMENT_ID = process.env.VITE_GA4_ID ?? 'G-5N7EE7KHVS';

type Stream = { name: string; displayName?: string; webStreamData?: { measurementId?: string } };

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const wanted = (args.find((arg) => arg.startsWith('--id='))?.slice(5) ?? MEASUREMENT_ID).trim();

  const api = await adminApi();
  const property = await findProperty(api, wanted);
  if (!property) return;

  console.log(`property: ${property}\nstream:   ${wanted}\n`);
  await syncParams(api, property, apply);
  await tighten(api, property, apply);

  if (!apply) console.log('\nничего не записано — повторите с --apply');
}

/**
 * The property behind a measurement id.
 *
 * Asked for by walking the accounts rather than by looking the id up, because
 * the Admin API has no lookup: a measurement id belongs to a *stream*, streams
 * are listed per property, and properties per account. Three round trips for a
 * property that is then printed and could be passed straight in next time —
 * which `--property=` is for.
 */
async function findProperty(api: Admin, measurementId: string): Promise<string | null> {
  const fromArgs = process.argv.slice(2).find((arg) => arg.startsWith('--property='));
  if (fromArgs) return fromArgs.slice('--property='.length);

  const summaries = (await api('GET', 'v1beta/accountSummaries')) as {
    accountSummaries?: Array<{ propertySummaries?: Array<{ property: string; displayName: string }> }>;
  };
  const properties = (summaries.accountSummaries ?? []).flatMap(
    (account) => account.propertySummaries ?? []
  );

  if (!properties.length) {
    console.log(
      'сервис-аккаунт не видит ни одного аккаунта Google Analytics.\n' +
        '\n' +
        'Аккаунт GA создаётся только руками, и доступ к нему выдаётся тоже руками:\n' +
        '  1. analytics.google.com → Admin → Account access management\n' +
        '  2. + → Add users → e-mail сервис-аккаунта из keys/ga4-admin.json\n' +
        '  3. роль Administrator\n' +
        '\n' +
        'После этого запустите ещё раз. Сайту доступ не нужен — он знает только\n' +
        'measurement id, который публичен по построению (docs/analytics.md).'
    );
    return null;
  }

  for (const summary of properties) {
    const streams = (await api('GET', `v1beta/${summary.property}/dataStreams`)) as {
      dataStreams?: Stream[];
    };
    const hit = (streams.dataStreams ?? []).find(
      (stream) => stream.webStreamData?.measurementId === measurementId
    );
    if (hit) return summary.property;
  }

  console.log(
    `ни в одном property нет потока ${measurementId}. Видны:\n` +
      properties.map((entry) => `  ${entry.property} — ${entry.displayName}`).join('\n')
  );
  return null;
}

/**
 * The registry, made real.
 *
 * A dimension and a metric of the same name cannot both exist, and neither can
 * be renamed after the fact without losing what was collected under the old
 * name — so a parameter that turns out to be the wrong kind is a new parameter,
 * not an edit. That is the reason `shared/analytics.ts` states the kind beside
 * every name instead of leaving it to whoever runs this.
 */
async function syncParams(api: Admin, property: string, apply: boolean): Promise<void> {
  const existing = {
    dimension: await listNames(api, property, 'customDimensions', 'customDimensions'),
    metric: await listNames(api, property, 'customMetrics', 'customMetrics'),
  };

  for (const [parameterName, spec] of Object.entries(ANALYTICS_PARAMS)) {
    const here = existing[spec.scope];
    if (here.has(parameterName)) {
      console.log(`  = ${spec.scope.padEnd(9)} ${parameterName}`);
      continue;
    }
    if (!apply) {
      console.log(`  + ${spec.scope.padEnd(9)} ${parameterName} — ${spec.label}`);
      continue;
    }
    const collection = spec.scope === 'dimension' ? 'customDimensions' : 'customMetrics';
    const body =
      spec.scope === 'dimension'
        ? { parameterName, displayName: spec.label, description: spec.note, scope: 'EVENT' }
        : {
            parameterName,
            displayName: spec.label,
            description: spec.note,
            scope: 'EVENT',
            measurementUnit: 'STANDARD',
          };
    try {
      await api('POST', `v1beta/${property}/${collection}`, body);
      console.log(`  + ${spec.scope.padEnd(9)} ${parameterName} — создано`);
    } catch (error) {
      // A name GA4 keeps for itself — `video_percent` and friends come with the
      // built-in video reporting — is refused, and that refusal is the right
      // answer rather than a failure: the dimension already exists, as theirs.
      console.log(`  ! ${spec.scope.padEnd(9)} ${parameterName} — ${(error as Error).message}`);
    }
  }
}

async function listNames(
  api: Admin,
  property: string,
  collection: string,
  field: string
): Promise<Set<string>> {
  const page = (await api('GET', `v1beta/${property}/${collection}?pageSize=200`)) as Record<
    string,
    Array<{ parameterName?: string }>
  >;
  return new Set((page[field] ?? []).map((entry) => entry.parameterName ?? ''));
}

/**
 * The two property-wide settings worth stating rather than inheriting.
 *
 * **Google signals off.** It is the half of GA4 that joins a visit to a signed-in
 * Google account to report age, sex and interests, and it is the half this site
 * has no business switching on. The frontend already refuses it per event
 * (`allow_google_signals: false`), and this is the same refusal one level up,
 * where a console click cannot undo it by accident.
 *
 * **Fourteen months of retention** rather than two. Two months cannot answer
 * whether a course opened last autumn is still opened, and the setting only
 * governs the event-level rows — the aggregate reports are kept regardless.
 *
 * Both live under `v1alpha` and both are best-effort: a property on a plan that
 * does not offer the longer retention refuses it, and the run is still a
 * success, because neither is what the script is for.
 */
async function tighten(api: Admin, property: string, apply: boolean): Promise<void> {
  if (!apply) {
    console.log('\n  + google signals → off, retention → 14 months');
    return;
  }
  const attempts: Array<[string, string, unknown]> = [
    [
      'google signals',
      `v1alpha/${property}/googleSignalsSettings?updateMask=state`,
      { state: 'GOOGLE_SIGNALS_DISABLED' },
    ],
    [
      'retention',
      `v1alpha/${property}/dataRetentionSettings?updateMask=eventDataRetention`,
      { eventDataRetention: 'FOURTEEN_MONTHS' },
    ],
  ];
  for (const [what, url, body] of attempts) {
    try {
      await api('PATCH', url, body);
      console.log(`\n  + ${what} — установлено`);
    } catch (error) {
      console.log(`\n  ! ${what} — ${(error as Error).message}`);
    }
  }
}

main().catch(reportRunError);
