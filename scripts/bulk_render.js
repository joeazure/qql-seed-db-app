const fs = require("fs");
const path = require("path");
const sharp = require('sharp');
const { ArgumentParser } = require("argparse");
const utils = require("../app/utils");
const image_utils = require("../app/image_utils");
const render = require("qql-headless/src/render");
const webp = require('webp-converter'); // Don't forget mkdir node_modules/webp-converter/temp

const RENDER_WIDTH = 1200;

async function main(parsedArgs) {
    // Args
    const outdir = parsedArgs.output;
    const wallet = parsedArgs.wallet;
    const namedTraits = parsedArgs.traits;
    const RENDER_COUNT = parsedArgs.count;
    const useDb = parsedArgs.use_db;
    const renderHost = parsedArgs.render_host;
    const twoRings = parsedArgs.two_rings;
    const palette = parsedArgs.palette_override;
    const bgColorOverride = parsedArgs.bg_color_override;
    const yunify = parsedArgs.yunify;
    const minPoints = parsedArgs.min_points;

    let seedList = []; 
    let i = 0;
    
    // calculate all the seeds first

    if (palette != undefined) {
      console.log(`Palette override set to: ${palette}`);
    }
    if (bgColorOverride != "none") {
      console.log(`Background color override set to ${bgColorOverride}`);
    }
    if (twoRings == "yes") {
      console.log("Two ring override specified!");
    }

    var traits;
    if (namedTraits != "random") {
      traits = utils.traitsFromNamed(namedTraits);
      console.log("Generating seeds with Traits:");
      console.log(JSON.stringify(traits, null, 2));
    } else {
      console.log("Generating seeds with random Traits");
    }
    while (i < RENDER_COUNT) {
      var seed;
      if (namedTraits == "random") {
        // use a completely random seed
        seed = utils.generateSeed(wallet);
      } else {
        // use traits to make a seed
        // const traits = utils.traitsFromNamed(namedTraits);
        // Palette override
        if (palette != undefined) {
          if (palette == "random") {
            traits["colorPalette"] = utils.randomPalette();
          } else {
            traits["colorPalette"] = palette;
          }
        }
        seed = utils.calcSeed(wallet, traits);
      }
      if (twoRings == "yes") {
        const s2 = seed.substr(0, seed.length-4) + 'e' + seed.substr(-3);
        seedList.push(s2);
      } else {
        seedList.push(seed);
      }
      i++;
    }
    console.log("Seed generation complete");
    console.log("Rendering outputs...");

    // render and save the outputs
    const fullOutdir = path.resolve(outdir); // for inserting into DB
    var timetaken = "Time taken to render " + RENDER_COUNT + " seeds";
    console.time(timetaken);

    // setup database if use_db is true
    var seed_db;
    if (useDb == true) {
      console.log("Setting up DB...");
      seed_db = require('../app/seed_db.js');
      console.log("DB Setup complete.");
    }

    for (let i = 0; i < seedList.length; i++) {
      seed = seedList[i];
      //render to buffer
      const { imageData, renderData } = await render({ seed, width: RENDER_WIDTH });
      if (bgColorOverride != "none") {
        if (renderData["backgroundColor"] != bgColorOverride) {
          console.log(`backgroundColor mismatch - ${renderData["backgroundColor"]} ... skipping render.`);
          continue;
        }
      }
      if (minPoints > 0) {
        if (renderData["numPoints"] < minPoints) {
          console.log(`Point count of ${renderData["numPoints"]}  below cutoff of ${minPoints}... skipping render.`);
          continue
        }
      }

      // filenames
      const basename = `${new Date().toISOString()}-${seed}.png`;
      const webpName = basename + ".webp";
      // files
      //const outfile = path.join(outdir, basename); // unused unless writing png file as well
      const webpFile = path.join(outdir, webpName);
      const infoFile = path.join(outdir, basename + ".txt");

      // write files
      const result = await webp.buffer2webpbuffer(imageData, "png", "-q 95");
      await fs.promises.writeFile(webpFile, result);

      await fs.promises.writeFile(infoFile, JSON.stringify(renderData, null, 2));

      // If you wish to save the rendered image as PNG as well, un-comment this:
      // await fs.promises.writeFile(outfile, imageData);

      // insert the render into the DB
      if (useDb) {
        await seed_db.insertRender(renderHost, fullOutdir, basename, seed, RENDER_WIDTH, renderData);
      }

      // For fun ... yunify
      if (yunify) {
        const yun_filename = path.join(outdir, "yun_" + basename);
        image_utils.overlayImage(sharp(imageData),
          '/Users/jazure/Development/qql-seed-db-app/resources/cow-2.png',
          yun_filename);
      }
    }
    console.timeEnd(timetaken);
}

// Command line arguments
const parser = new ArgumentParser({ description: 'Bulk Render QQL outputs.' });
parser.add_argument("--output", "--o", {help: "The directory for the output files", required: true});
parser.add_argument("--wallet", "--w", {help: "The ethereum wallet address (0x...)", required: true});
parser.add_argument("--traits", {help: "The named traits to render for (do not inlude '.json')", default: "random"});
parser.add_argument("--two_rings", {help: "Set to 'yes' to hack seed for 2-ring outputs", default: "no"});
parser.add_argument("--palette_override", {help: "Set to a palette name or 'random' to override the palette in the named 'traits'"});
parser.add_argument("--bg_color_override", {help: "Set to a valid color name for the palette specified in palette_override", default: "none"});
parser.add_argument("--min_points", {help: "Set to positive number to only save outputs with at least this many points", type: Number, default: 0});
parser.add_argument("--yunify", {help: "Set to true to YUNIFY an output", type: Boolean, default: false});
parser.add_argument("--use_db", {help: "Set to true to store the seed data into the database", type: Boolean, default: false});
parser.add_argument("--render_host", {help: "The hostname to use for saving to the database. Ignored when use-db is false."});
parser.add_argument("count", {type: 'int', help: "The number of outputs to render"});

main(parser.parse_args()).catch((e) => {
  process.exitCode = process.exitCode || 1;
  console.error(e);
});
