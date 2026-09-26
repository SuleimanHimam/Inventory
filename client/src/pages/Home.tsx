import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';
import { usePermissions } from '@/lib/permissions';
import { fmtInt } from '@/lib/format';
import { NotesModal } from '@/components/NotesModal';
import {
  useHomeTiles, loadPrefs, TONE, type Tile, type Tone,
} from '@/lib/homeTiles';

/**
 * The launcher home.
 *
 * A grid of big, tinted, thumb-sized tiles, one per thing the operator does.
 * Everything here is a shortcut to a screen that already exists and already
 * guards itself; this only decides what to *offer*, and mirrors the roles the
 * rest of the app enforces (usePermissions) so no account is shown a tile it
 * may not open.
 *
 * The tile list and each user's customization of it (which tiles show, and the
 * colour of each) live in `@/lib/homeTiles`, shared with the Settings screen
 * where the customization now happens — this screen only renders. Prefs are
 * read once on mount from localStorage, so a change made in Settings shows the
 * next time Home is opened.
 */
export default function Home() {
  const { isManager } = usePermissions();
  const [notesOpen, setNotesOpen] = useState(false);
  const tiles = useHomeTiles({ onNotes: () => setNotesOpen(true) });
  // Read once per mount; the Settings customizer writes the same key.
  const [prefs] = useState(loadPrefs);

  const toneOf = (t: Tile): Tone => prefs[t.id]?.tone ?? t.tone;
  const customColor = (t: Tile) => prefs[t.id]?.color;
  const customFg = (t: Tile) => prefs[t.id]?.fg;
  const isHidden = (t: Tile) => !!prefs[t.id]?.hidden;
  const colorClass = (t: Tile) => (customColor(t) ? 'text-white' : TONE[toneOf(t)]);
  const colorStyle = (t: Tile) => {
    const st: CSSProperties = {};
    if (customColor(t)) st.backgroundColor = customColor(t);
    if (customFg(t)) st.color = customFg(t);
    return Object.keys(st).length ? st : undefined;
  };

  const shown = tiles.filter((t) => !isHidden(t));
  const tileClass = 'group relative flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl p-2 text-center shadow-sm transition active:scale-[.96] hover:brightness-105';

  const inner = (tile: Tile) => (
    <>
      {!!tile.badge && tile.badge > 0 && (
        <span className="nums absolute end-1.5 top-1.5 rounded-full bg-white px-1.5 text-[11px] font-bold leading-5 text-accent-700 shadow">
          {fmtInt(tile.badge)}
        </span>
      )}
      <tile.icon className="size-7 transition-transform group-hover:scale-110" />
      <span className="text-xs font-bold leading-tight">{tile.label}</span>
    </>
  );

  return (
    <>
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
        {shown.map((tile) => {
          const cls = cn(tileClass, colorClass(tile));
          const style = colorStyle(tile);
          return tile.to ? (
            <Link key={tile.id} to={tile.to} className={cls} style={style}>{inner(tile)}</Link>
          ) : (
            <button key={tile.id} type="button" onClick={tile.onClick} className={cls} style={style}>{inner(tile)}</button>
          );
        })}
      </div>

      {isManager && <NotesModal open={notesOpen} onClose={() => setNotesOpen(false)} />}
    </>
  );
}
