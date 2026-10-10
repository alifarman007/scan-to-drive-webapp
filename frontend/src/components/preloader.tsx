/**
 * The opening moment: the Epic logo comes in, a line draws under it, the motto rises word by word, and the
 * navy curtain lifts to show the page (about 3 seconds). Plain HTML and CSS, so it plays straight away,
 * even before the app's JavaScript has loaded.
 *
 * Shown once per browser tab (a reload in the same tab skips it), never on the passenger pages (/p/...),
 * where the one-time code is already counting down. With "reduce motion" it simply fades.
 */
const MOTTO = "Relentless pursuit of better";

// Runs before the first paint: decides whether the preloader plays, and lets the page know.
const DECIDE = `(function(){try{var d=document.documentElement;
if(location.pathname.indexOf('/p/')===0||sessionStorage.getItem('s2d.intro')){d.classList.add('s2d-no-intro');return;}
sessionStorage.setItem('s2d.intro','1');d.classList.add('s2d-intro');
setTimeout(function(){d.classList.add('s2d-intro-done')},3600);}catch(e){document.documentElement.classList.add('s2d-no-intro');}})();`;

export function Preloader() {
  // each letter knows its place in the whole motto, for the letter-by-letter delay
  const words = MOTTO.split(" ").map((w, wi, all) => {
    const start = all.slice(0, wi).reduce((n, x) => n + x.length, 0);
    return w.split("").map((ch, ci) => ({ ch, i: start + ci }));
  });
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: DECIDE }} />
      <div className="s2d-preloader" aria-hidden="true">
        <div className="s2d-preloader__glow" />
        <div className="s2d-preloader__stage">
          {/* eslint-disable-next-line @next/next/no-img-element -- must show before the app loads */}
          <img className="s2d-preloader__logo" src="/brand/epic-logo-light.png" alt="" width={286} height={124} />
          <span className="s2d-preloader__line" />
          <p className="s2d-preloader__motto">
            {words.map((letters, wi) => (
              <span key={wi} className="s2d-preloader__word">
                {letters.map(({ ch, i }) => (
                  <span key={i} className="s2d-preloader__char" style={{ "--i": i } as React.CSSProperties}>
                    {ch}
                  </span>
                ))}
              </span>
            ))}
          </p>
        </div>
      </div>
    </>
  );
}
