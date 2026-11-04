const auth = require("./auth");
const { fetchProfileNotes } = require("./fetch-profile");
const { fetchNoteMedia, noteIdFromUrl } = require("./fetch-media");
const { fetchNotesByUrls, looksLikeNoteUrl } = require("./fetch-note");
const { fetchSearchNotes } = require("./fetch-search");
const { publishNote } = require("./publish-note");
const { publishVideo } = require("./publish-video");

module.exports = {
  login: auth.loginInteractive,
  loadCookie: auth.loadCookie,
  getCookieStatus: auth.getCookieStatus,
  clearLocalAuth: auth.clearLocalAuth,
  fetchProfileNotes,
  fetchNoteMedia,
  fetchNotesByUrls,
  fetchSearchNotes,
  looksLikeNoteUrl,
  noteIdFromUrl,
  publishNote,
  publishVideo,
};
