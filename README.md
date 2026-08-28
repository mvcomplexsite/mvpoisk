# MVPoisk v32

Stable desktop/mobile UI restored from v30, with a rebuilt TV layer.

TV fixes:
- TV mode is no longer persisted in localStorage, so desktop cannot become stuck in TV layout;
- no forced `width=1920` viewport;
- TV search field never receives automatic focus;
- compact 16:9 TV proportions and horizontal shelves;
- movie page keeps backdrop-first TV layout without desktop changes;
- Watch opens a fixed full-screen player shell on TV;
- parent D-pad navigation is disabled while the player is open;
- Android TV wrapper v3 supplies a virtual cursor for cross-origin player controls (Play / season / episode / voice);
- Back closes the player and returns to the movie page.

The Cloudflare Worker/API integration is unchanged.
