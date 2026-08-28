# MVPoisk v31

Static MVPoisk site for GitHub Pages / Cloudflare-backed API.

## v31 TV pass

- fixed 1920x1080 CSS viewport for 4K Android TV WebView;
- safe-zone layout so focus scrolling no longer shifts the whole page sideways;
- TV home uses horizontal poster shelves and hides desktop filter controls;
- movie page uses a backdrop-led TV layout without the desktop poster column;
- TV-only actions: Watch, Watch later, Favorites, More;
- Kinopoisk external button is hidden on TV;
- More reveals Mark watched and Alternate source;
- Watch opens the partner player as a full-screen TV surface;
- season / episode / voice controls remain inside the partner iframe;
- Back returns from the player to the movie page through a same-page history state;
- D-pad navigation does not steal arrow keys after the partner iframe receives focus;
- primary Rendex integration and lazy Kinobox reserve remain unchanged at provider level.

TV URL:
`https://mvcomplexsite.github.io/mvpoisk/?tv=1`
