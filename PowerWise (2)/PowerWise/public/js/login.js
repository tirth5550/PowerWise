(function () {
  "use strict";
  const $ = function (s) { return document.querySelector(s); };

  function show(tab) {
    const login = tab === "login";
    $("#loginForm").hidden = !login;
    $("#registerForm").hidden = login;
    $("#tabLogin").classList.toggle("active", login);
    $("#tabRegister").classList.toggle("active", !login);
    $("#authError").textContent = "";
    (login ? $("#l_user") : $("#r_name")).focus();
  }

  function goHome(user) {
    location.href = user.role === "admin" ? "admin.html" : "bills.html";
  }

  function fail(e) {
    if (e.message === "SERVER_OFFLINE") { PW.showOffline(); $("#authError").textContent = "Cannot reach the server."; }
    else $("#authError").textContent = e.message;
  }

  $("#tabLogin").addEventListener("click", function () { show("login"); });
  $("#tabRegister").addEventListener("click", function () { show("register"); });

  $("#showPass").addEventListener("change", function (e) {
    ["#l_pass", "#r_pass", "#r_pass2"].forEach(function (s) { $(s).type = e.target.checked ? "text" : "password"; });
  });

  $("#loginForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    $("#authError").textContent = "";
    try {
      const d = await PW.api("POST", "/api/login", { username: $("#l_user").value, password: $("#l_pass").value });
      goHome(d.user);
    } catch (err) { fail(err); }
  });

  $("#registerForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    $("#authError").textContent = "";
    if ($("#r_pass").value !== $("#r_pass2").value) { $("#authError").textContent = "The two passwords do not match."; return; }
    try {
      const d = await PW.api("POST", "/api/register", {
        name: $("#r_name").value, username: $("#r_user").value, password: $("#r_pass").value,
      });
      goHome(d.user);
    } catch (err) { fail(err); }
  });

  $("#switchBtn").addEventListener("click", async function () {
    try { await PW.api("POST", "/api/logout", {}); } catch (e) { /* ignore */ }
    $("#already").hidden = true;
    $("#authBox").hidden = false;
  });

  // The login page is always shown first. If a login is still active, offer to continue.
  (async function start() {
    PW.refreshTheme();
    try {
      const me = await PW.api("GET", "/api/me");
      $("#whoName").textContent = me.user.name;
      $("#continueBtn").href = me.user.role === "admin" ? "admin.html" : "bills.html";
      $("#already").hidden = false;
      $("#authBox").hidden = true;
    } catch (e) {
      if (e.message === "SERVER_OFFLINE") PW.showOffline();
    }
  })();
})();
