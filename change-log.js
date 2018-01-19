/**
 * ARGS:
 * R1: Revision, tag or branch you want compare with R2 otherwise latest tag.
 * R2: Revision, tag or branch you want compare with R1 otherwise previous tag of R1.
 * all: if use this param the task show all the bower dependencies otherwise filter on conectus modules(name start with 'dwx-' or 'consectus-' or 'ofsui')
 * nopush: use this param for not create changelog file and push it
 * nopublish: use this param for not create confluence content and publish it
 * confluencepageid: identifier for confluence page id otherwise it will take from env config
 */

const env = require('../env.js'),
  argv = require('yargs').argv,
  execSync = require('child_process').execSync,
  Table = require('cli-table'),
  fs = require('fs'),
  gutil = require('gulp-util'),
  Confluence = require("confluence-api"),
  request = require('superagent');

module.exports = function () {

  function isConectusModules(name) {
    return name.indexOf("dwx-") !== -1 || name.indexOf("conectus-") !== -1 || name.indexOf("ofsui") !== -1;
  }

  function replaceAll(str, find, replace) {
    return str.split(find).join(replace)
  }

  function cleanStr(str) {
    str = replaceAll(str, "[90m", '');
    str = replaceAll(str, "[39m", '');
    str = replaceAll(str, "[31m", '');
    return str;
  }

  function addEndLine(str) {
    return replaceAll(str, "\n", "<br/>");
  }

  function retrieveLastTag() {
    // var lastTag = execSync("git describe --abbrev=0 --tags");
    var lastTag = execSync("git rev-list --tags --max-count=1");
    lastTag = execSync("git describe --abbrev=0 --tags " + lastTag);
    return ("" + lastTag).trim();
  }

  function retrievePreviousOfLastTag() {
    var rev = execSync("git rev-list --tags --skip=1 --max-count=1");
    rev = execSync("git describe --abbrev=0 --tags " + rev);
    return ("" + rev).trim();
  }

  function deleteFolderRecursive(path) {
    if( fs.existsSync(path) ) {
      fs.readdirSync(path).forEach(function(file,index){
        var curPath = path + "/" + file;
        if(fs.lstatSync(curPath).isDirectory()) { // recurse
          deleteFolderRecursive(curPath);
        } else { // delete file
          fs.unlinkSync(curPath);
        }
      });
      fs.rmdirSync(path);
    }
  };

  function addRow(table, content) {
    table += "" +
      "<tr>" +
      "<td>" + content[0] + "</td>" +
      "<td>" + content[1] + "</td>" +
      "<td>" + content[2] + "</td>" +
      "<td>" + content[3] + "</td>" +
      "</tr>";
    return table;
  }

  function updatePage(id, version, title, content, config, callback){

    var page = {
      "id": id,
      "type": "page",
      "title": title,
      "version": {
        "number": version,
        "minorEdit": false
      },
      "body": {
        "storage": {
          "value": content,
          "representation": "storage"
        }
      }
    };

    request
      .put(config.baseUrl + config.apiPath + "/content/" + id + config.extension + "?expand=body.storage,version")
      .auth(config.username, config.password)
      .type('json')
      .send(page)
      .end(function(err, res){
        processCallback(callback, err, res);
      });

  };

  function processCallback(cb, err, res) {
    if (err || !res || !res.body) {
      cb(err, res);
    }
    else {
      cb(err, res.body);
    }
  }

  function createChangeLogFile(htmlTable, fileName) {

    // Delete if file exist
    if (fs.existsSync(fileName)) {
      fs.unlinkSync(fileName);
    }

    // Write changelog file
    fs.writeFile(fileName, htmlTable, function () {

      gutil.log("Changelog file created");

      // Commit and push changelog file
      try {
        gutil.log("git add .");
        execSync("git add .");
        gutil.log('git diff');
        execSync("git diff");
        gutil.log('git commit -am "Add changelog file"');
        execSync('git commit -am "Add changelog file"');
        gutil.log("git push");
        execSync("git push");
        gutil.log("Changelog file pushed");
      } catch(e) {
        gutil.log("No changes to push");
      }

    });

  }

  function createChangeLogConfluencePage(htmlTable, confluencePageId) {

    if (confluencePageId) {

      var config = {
        username: "jenkins",
        password: "jenkins",
        baseUrl: "https://owconfluence.objectway.it"
      };

      var confluence = new Confluence(config);

      confluence.getContentById(confluencePageId, function (err, data) {

        var version = data.version.number + 1;
        var page = htmlTable + "<br/><br/>" + data.body.storage.value;
        updatePage(data.id, version, data.title, page, config, function (err, data) {

          if (err) {
            gutil.log(err);
          } else {
            gutil.log("Content published successfully on confluence page: " + data.id + " - " + data.title + " - " + data._links.base + data._links.webui);
          }

        });

      });

    } else {
      gutil.log("No config found for publish confluence content. confluencePageId needed.");
    }

  }

  // Retrieve args
  var R1 = argv.R1;
  var R2 = argv.R2;
  var all = argv.all;
  var nopush = argv.nopush;
  var nopublish = argv.nopublish;
  var cpi = argv.confluencepageid;

  // fetch all for read properly revisions
  gutil.log("git fetch --all");
  execSync("git fetch --all");

  // if not specified retrieve previous of last tag
  if (!R1) {
    R1 = retrievePreviousOfLastTag();
  }

  // if not specified retrieve last tag
  if (!R2) {
    R2 = retrieveLastTag();
  }

  // Create Head Table
  var table = new Table({
    head: ["MODULE", "OLD", "NEW", "HISTORY"]
  });

  var htmlTable = "<b>CHANGELOG BETWEEN " + R1 + " and " + R2 + " REVISIONS OF " + new Date().toString() + "</b><br/>" +
    "<table border='1'>" +
    "<tr>" +
    "<th>MODULE</th>" +
    "<th>OLD</th>" +
    "<th>NEW</th>" +
    "<th>HISTORY</th>" +
    "</tr>";

  // Retrieve bower.json dependencies
  var widgetsR1 = JSON.parse(execSync("git show " + R1 + ":bower.json")).dependencies;
  var widgetsR2 = JSON.parse(execSync("git show " + R2 + ":bower.json")).dependencies;

  var versionR1, widgetPath;
  var versionR2;

  // Match dependencies modified and push into table
  Object.keys(widgetsR2).forEach(function(widgetName) {

    if (all || isConectusModules(widgetName)) {

      versionR1 = (widgetsR1[widgetName]) ? widgetsR1[widgetName] : undefined;
      versionR2 = (widgetsR2[widgetName]) ? widgetsR2[widgetName] : undefined;

      if (versionR2.indexOf('#') !== -1) {
        versionR2 = versionR2.split('#')[1];
      }

      // If the widget was not found in bower.json of R1 it is a new widget
      if (!versionR1) {
        table.push([widgetName, "-", versionR2, "NEW WIDGET"]);
        htmlTable = addRow(htmlTable, [widgetName, "-", versionR2, "NEW WIDGET"]);
        return;
      }

      if (versionR1.indexOf('#') !== -1) {
        var versionSplit = versionR1.split('#');
        widgetPath = versionSplit[0];
        versionR1 = versionSplit[1];
      }

      if (versionR1 !== versionR2) {

        if (fs.existsSync("./" + widgetName)) {
          deleteFolderRecursive(widgetName);
        }

        gutil.log('git clone ' + widgetPath);
        execSync("git clone " + widgetPath);

        gutil.log("git fetch --all --tags --progress");
        execSync("git fetch --all --tags --progress", {cwd: "./" + widgetName});

        gutil.log('git log --pretty="tformat:%h | %ad | %s%d [%an]" --date=short ' + versionR1 + '...' + versionR2);
        var commitMessages = execSync('git log --pretty="tformat:%h | %ad | %s%d [%an]" --date=short ' + versionR1 + '...' + versionR2, {cwd: "./" + widgetName});

        gutil.log("delete temp folder: " + widgetName);
        deleteFolderRecursive(widgetName);

        commitMessages = commitMessages.toString();

        table.push([widgetName, versionR1, versionR2, commitMessages]);
        htmlTable = addRow(htmlTable, [widgetName, versionR1, versionR2, addEndLine(commitMessages)]);

      }

      widgetPath = undefined;
      versionR1 = undefined;
      versionR2 = undefined;

    }

  });

  // Write table in console
  gutil.log("\n" + table.toString());

  htmlTable += "</table>";

  if (!nopush) {
    // Start write table in changelog file
    createChangeLogFile(htmlTable, "changelog-" + R1 + "-" + R2 + ".html");
  }

  if (!nopublish) {
    // Start publish changelog to confluence
    createChangeLogConfluencePage(htmlTable, cpi ? cpi : env.confluencePageId);
  }

};
