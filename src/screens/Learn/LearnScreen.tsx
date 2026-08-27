import { Link } from 'react-router-dom';
import { useT } from '@/i18n';
import { useIsMobile } from '@/lib/hooks';
import { useDocumentMeta } from '@/lib/meta';
import ContributeBar from '@/components/ContributeBar';
import FloatingFoot from '@/components/FloatingFoot';
import LangToggle from '@/components/LangToggle';
import BottomNav, { PlaceSwitch } from '@/components/PlaceNav';
import ProfileButton from '@/components/ProfileButton';
import ThemeToggle from '@/components/ThemeToggle';
import { Plate, PlateDivider } from '@/components/ui';
import StudyBoard from './StudyBoard';

/**
 * The desk — `/learn`.
 *
 * The second front door. A catalogue's front page answers "what is there",
 * and somebody who watched a lecture last night is asking "where was I": the
 * same address served both, with the second answer folded into a plate in the
 * corner of a map and, on a phone, into a bar one line tall. So the answer got
 * a place, and with it everything a place has — an address to link to, a back
 * button that behaves, a page a home-screen icon can open on, and room for the
 * shelves that used to live two presses deep behind an avatar.
 *
 * A reader with a history is sent here from `/` on arrival; see `lib/entry.ts`
 * for why that is a redirect on the first load only, and not a rule about who
 * gets the map.
 *
 * Written at build time like every other address, and out of search like no
 * other: the file exists so the address answers with 200 instead of the 404
 * page a static host gives a path it has no file for, and the `noindex` is
 * because everything on it comes out of the reader's own browser. To anybody
 * else it is an invitation with nothing on it.
 */
export default function LearnScreen() {
  const { t } = useT();
  const isMobile = useIsMobile();

  useDocumentMeta(t('seo.learn.title'), t('seo.learn.desc'), 'learn', { index: false });

  return (
    <div className="flex h-full flex-col">
      <header className="relative z-30 flex items-start justify-between gap-4 px-4 pt-4 sm:px-6">
        <div className="flex items-baseline gap-3">
          {/* The wordmark is the way home, as it is on every site — and home
              is the catalogue, on this screen as on the columns. */}
          <h1 className="font-display text-xl tracking-tight">
            <Link to="/" className="rounded transition-colors hover:text-accent">
              {t('app.title')}
            </Link>
          </h1>
          <p className="hidden text-xs text-ink-faint lg:block">{t('app.tagline')}</p>
        </div>

        {/* The same two plates the map carries, in the same corner: what you
            are looking at on the left, who is looking on the right. On a phone
            neither is here — the places are a bar under the thumb and the
            profile is one of them. */}
        <div className="flex items-center gap-2">
          {isMobile ? null : <PlaceSwitch />}
          <Plate row>
            <LangToggle />
            <ThemeToggle />
            {isMobile ? null : (
              <>
                <PlateDivider />
                <ProfileButton label />
              </>
            )}
          </Plate>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto">
        {/* Room at the foot for the navigation, which floats over this column
            on a phone rather than taking a row of its own. */}
        <div className="mx-auto w-full max-w-4xl px-4 pb-24 pt-4 sm:px-6 sm:pb-10">
          <StudyBoard />
        </div>
        {isMobile ? (
          <FloatingFoot>
            <BottomNav />
          </FloatingFoot>
        ) : null}
      </main>

      <ContributeBar>{t('ui.footer.contribute')}</ContributeBar>
    </div>
  );
}
