process.env.NEW_RELIC_BROWSER_MONITOR_ENABLE = false;

// New Relic Server monitoring support
var newrelic;
if ( process.env.NEW_RELIC_ENABLED ) {
  newrelic = require( "newrelic" );
} else {
  newrelic = {
    getBrowserTimingHeader: function () {
      return "<!-- New Relic RUM disabled -->";
    }
  };
}

var express    = require("express"),
    goggles    = require("./lib/goggles"),
    habitat    = require("habitat"),
    helmet     = require("helmet"),
    i18n       = require("webmaker-i18n"),
    lessMiddleWare = require("less-middleware"),
    nunjucks   = require("nunjucks"),
    path       = require("path"),
    version    = require("./package").version,
    wts        = require("webmaker-translation-stats"),
    WWW_ROOT   = path.resolve(__dirname, 'public');

// Load config from ".env"
habitat.load();

// Generate app variables
var app = express(),
    appName = "goggles",
    env = new habitat(),
    node_env = env.get('NODE_ENV'),
    nunjucksEnv = new nunjucks.Environment([
      new nunjucks.FileSystemLoader(path.join(__dirname, 'views')),
      new nunjucks.FileSystemLoader(path.join(__dirname, 'public/bower'))
    ], {
      autoescape: true
    });

// No need to tell the world this:
app.disable("x-powered-by");

// Enable template rendering with nunjucks
nunjucksEnv.express(app);
nunjucksEnv.addFilter( "instantiate", function( input ) {
    var tmpl = new nunjucks.Template( input );
    return tmpl.render( this.getVariables() );
});

// log either to GELF or console
if (env.get("ENABLE_GELF_LOGS")) {
  messina = require("messina");
  logger = messina("goggles.webmaker.org-" + env.get("NODE_ENV") || "development" );
  logger.init();
  app.use(logger.middleware());
} else {
  app.use(express.logger("dev"));
}

app.use(helmet.iexss());
app.use(helmet.contentTypeOptions());
if (!!env.get("FORCE_SSL") ) {
  app.use(helmet.hsts());
  app.enable("trust proxy");
}
app.use(express.favicon(__dirname + '/public/img/favicon.ico'));
app.use(express.compress());
app.use(express.json());
app.use(express.urlencoded());

// Setup locales with i18n
app.use( i18n.middleware({
  supported_languages: env.get("SUPPORTED_LANGS"),
  default_lang: "en-US",
  mappings: require("webmaker-locale-mapping"),
  translation_directory: path.resolve( __dirname, "locale" )
}));

app.use(require("xfo-whitelist")([
  "/easy-remix-dialog/index.html",
  "/easy-remix-dialog/blank.html",
  "/preferences.html",
  "/uproot-dialog.html"
]));

app.locals({
  GA_ACCOUNT: env.get("GA_ACCOUNT"),
  GA_DOMAIN: env.get("GA_DOMAIN"),
  hostname: env.get("APP_HOSTNAME"),
  languages: i18n.getSupportLanguages(),
  newrelic: newrelic,
  bower_path: "public/bower"
});

// universal error handling
app.use(function(err, req, res, next) {
  console.error(err.msg);
  throw err;
});

// DEVOPS - Healthcheck
app.get('/healthcheck', function(req, res) {
  var healthcheckObject = {
    http: "okay",
    version: version
  };
  wts(i18n.getSupportLanguages(), path.join(__dirname, "locale"), function(err, data) {
    if(err) {
      healthcheckObject.locales = err.toString();
    } else {
      healthcheckObject.locales = data;
    }
    res.json(healthcheckObject);
  });
});

// oauth login confirmation page
app.get("/login-confirmation.html", function(req, res) {
  res.render("login-confirmation.html");
});

// intercept webxray's publication dialog - HTML part
app.get("/uproot-dialog.html", function(req, res) {
  res.render("uproot-dialog.html");
});

// intercept webxray's publication dialog - JS part
app.get("/publication.js", function(req, res) {
  res.set( "Content-Type", "application/javascript; charset=utf-8" );
  res.render("publication.js", {
    idwmoURL: env.get("ID_WMO_URL"),
    publishwmoURL: env.get("PUBLISH_WMO_URL")
  });
});

var optimize = (node_env !== "development"),
    tmpDir = path.join( require("os").tmpDir(), "mozilla.webmaker.org");

app.use(lessMiddleWare({
  once: optimize,
  debug: !optimize,
  dest: tmpDir,
  src: WWW_ROOT,
  compress: true,
  yuicompress: optimize,
  optimization: optimize ? 0 : 2
}));

// serve static content, resolved in this order:
app.use(express.static(tmpDir));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname, "webxray/static-files")));
["src", "test", "js"].forEach(function(dir) {
  app.use("/" + dir, express.static(path.join(__dirname, "webxray/" + dir)));
});

// Localized Strings
app.get("/strings/:lang?", function( req, res, next ) {
  res.header( "Access-Control-Allow-Origin", "*" );
  res.jsonp(i18n.getStrings(req.params.lang || req.localeInfo.lang || "en-US"));
});

// override some path
app.get("/easy-remix-dialog/index.html", function(req, res) {
  res.render("/easy-remix-dialog/index.html");
});

// build webxray and then run the app server
goggles.build(env, nunjucksEnv, function() {
  app.listen(env.get("port"), function(){
    console.log('Express server listening on ' + env.get("APP_HOSTNAME"));
  });
});
