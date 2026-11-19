# GevaDub

One song, the whole group. Everyone records their part at home, and nobody hears the others until the premiere.

## Running it

```
node server.js
```

Then open http://localhost:5180. No `npm install`: the server is plain Node with no dependencies.

To test with friends on other phones, the site has to be on HTTPS (browsers only allow the mic and camera on HTTPS or on localhost). The easiest way is to deploy to a host that runs Node, such as Render, Railway or Fly.io, and point a subdomain like `dub.gevastudio.com` at it.

## How it's built

| File | What it does |
|---|---|
| `server.js` | Rooms, joining, the split, the dice draw (done on the server so nobody can rig it), take uploads, and the premiere clock. Takes are only revealed once everyone has recorded. |
| `public/js/songs.js` | GevaDub's two songs, fully synthesized in the browser. "Happy Birthday" (public-domain melody) and "החבר'ה" (original). |
| `public/js/gallery.js` | Songs from the gallery: removes the singer with the stereo-center trick, plus a fingerprint so everyone in the room picks the same song. The file never leaves the device. |
| `public/js/split.js` | Smart split by vocal range, or random. |
| `public/js/autotune.js` | The dice: hard-snap auto-tune (TD-PSOLA) to a pentatonic scale. |
| `public/js/mix.js` | Builds the final track: everyone's take cut to their lines, with the chorus spread across the stereo field. |
| `public/js/stats.js` | Awards measured from the takes: pitch accuracy, loudness, presence. |
| `public/js/stage.js` | The 1080x1920 vertical video: studio card, faces, karaoke lyrics with the studio line, end card. Also video export and the meme. |
| `public/js/screens/*` | The screens: create, room, recording, premiere. |

## Known limitations

- Removing the singer from a gallery song uses the classic stereo method. It works well when the singer is centered and the instruments are spread out, and less well on other mixes. Full AI vocal separation (like Demucs) is a possible next step.
- Lyrics for gallery songs are pasted in and timed by tapping. There's no automatic lyric recognition yet.
- Rooms are kept in a JSON file on the server. That's fine to start with; with lots of users, move to a real database and file storage.
