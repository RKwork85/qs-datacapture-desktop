const auth = require("./auth");
const { fetchProfileNotes } = require("./fetch-profile");
const { fetchNoteMedia } = require("./fetch-media");
const { fetchAwemeByUrls, looksLikeVideoUrl, extractAwemeId } = require("./fetch-aweme");
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
  fetchAwemeByUrls,
  fetchSearchNotes,
  looksLikeVideoUrl,
  extractAwemeId,
  publishNote,
  publishVideo,
};
