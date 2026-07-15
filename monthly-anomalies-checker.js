/**
 * =======================================================================
 * Google Ads Month-over-Month Anomaly Detector & Dashboard Builder
 * =======================================================================
 *
 * SETUP INSTRUCTIONS:
 * 1. Create a new, blank Google Sheet and copy its ID from the URL.
 *    (e.g., https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID/edit)
 * 2. Paste the ID into the SPREADSHEET_ID variable below.
 * 3. Update the TARGET_CONVERSIONS array with the EXACT names of the
 *    conversion actions you want to track (Case-Sensitive).
 * 4. Update the EMAIL_RECIPIENTS array with your team's email addresses.
 * 5. Schedule this script to run Monthly (e.g., on the 3rd or 4th of the month).
 * =======================================================================
 */

function main() {
   // ==========================================
  // CONFIGURATION
  // ==========================================
  var SPREADSHEET_ID = "INSERT_YOUR_SPREADSHEET_ID_HERE";
   var ANOMALY_THRESHOLD = 0.15; // 15% MoM change triggers an anomaly log

  // EXACT names of the conversion actions you want to track.
  // Must match the Google Ads "Conversions" summary exactly.
  var TARGET_CONVERSIONS = [
       "Example Form Submit",
       "Example Phone Call",
       "Example Purchase"
     ];

  // Email recipients for the automated anomaly report
  var EMAIL_RECIPIENTS = [
       "marketing@yourdomain.com",
       "analytics@yourdomain.com"
     ];

  var performanceAnomalies = [];
   var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  Logger.log("Running acquisition performance anomaly check...");
   checkAcquisitionAnomalies(ANOMALY_THRESHOLD, TARGET_CONVERSIONS, performanceAnomalies);

  // Determine the names of the two months being compared for the headers and tab name
  var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
   var today = new Date();

  var analysisDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
   var tabName = months[analysisDate.getMonth()] + " " + analysisDate.getFullYear(); // e.g., "July 2026"

  var priorAnalysisDate = new Date(today.getFullYear(), today.getMonth() - 2, 1);
   var priorTabName = months[priorAnalysisDate.getMonth()] + " " + priorAnalysisDate.getFullYear(); // e.g., "June 2026"

  // Build the dashboard in the Google Sheet
  writeAnomaliesToSheet(ss, tabName, priorTabName, performanceAnomalies);

  // Send the email report
  sendEmailReport(EMAIL_RECIPIENTS, performanceAnomalies, tabName, ss.getUrl());
}

function checkAcquisitionAnomalies(threshold, targetConversions, anomaliesArray) {
   var timeZone = AdsApp.currentAccount().getTimeZone();
   var today = new Date();

  // Calculate the exact start and end dates for the two previous full months
  var lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
   var lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);

  var priorMonthStart = new Date(today.getFullYear(), today.getMonth() - 2, 1);
   var priorMonthEnd = new Date(today.getFullYear(), today.getMonth() - 1, 0);

  var currentStartStr = Utilities.formatDate(lastMonthStart, timeZone, "yyyyMMdd");
   var currentEndStr = Utilities.formatDate(lastMonthEnd, timeZone, "yyyyMMdd");
   var priorStartStr = Utilities.formatDate(priorMonthStart, timeZone, "yyyyMMdd");
   var priorEndStr = Utilities.formatDate(priorMonthEnd, timeZone, "yyyyMMdd");

  var currentConvData = getSpecificConversionData(currentStartStr, currentEndStr);
   var priorConvData = getSpecificConversionData(priorStartStr, priorEndStr);

  var campaignSelector = AdsApp.campaigns().withCondition("Status = ENABLED");
   var campaignIterator = campaignSelector.get();

  while (campaignIterator.hasNext()) {
       var campaign = campaignIterator.next();
       var campName = campaign.getName();

     var thisMonthStats = campaign.getStatsFor(currentStartStr, currentEndStr);
       var lastMonthStats = campaign.getStatsFor(priorStartStr, priorEndStr);

     var currentCost = thisMonthStats.getCost();
       var priorCost = lastMonthStats.getCost();

     var metrics = [
      { name: "Cost", current: currentCost, prior: priorCost, isCurrency: true },
      { name: "CTR", current: thisMonthStats.getCtr(), prior: lastMonthStats.getCtr(), isPercent: true },
      { name: "Avg CPC", current: thisMonthStats.getAverageCpc(), prior: lastMonthStats.getAverageCpc(), isCurrency: true }
          ];

     var currAllConvs = thisMonthStats.getConversions();
       var priorAllConvs = lastMonthStats.getConversions();

     metrics.push({ name: "All Conversions", current: currAllConvs, prior: priorAllConvs, isCurrency: false });

     var currAllCpa = currAllConvs > 0 ? currentCost / currAllConvs : 0;
       var priorAllCpa = priorAllConvs > 0 ? priorCost / priorAllConvs : 0;

     metrics.push({ name: "Cost / All Conversions", current: currAllCpa, prior: priorAllCpa, isCurrency: true });

     targetConversions.forEach(function(convName) {
            var currConvs = (currentConvData[campName] && currentConvData[campName][convName]) ? currentConvData[campName][convName] : 0;
            var priorConvs = (priorConvData[campName] && priorConvData[campName][convName]) ? priorConvData[campName][convName] : 0;

                                     metrics.push({ name: "Conv: " + convName, current: currConvs, prior: priorConvs, isCurrency: false });

                                     var currCpa = currConvs > 0 ? currentCost / currConvs : 0;
            var priorCpa = priorConvs > 0 ? priorCost / priorConvs : 0;

                                     metrics.push({ name: "CPA: " + convName, current: currCpa, prior: priorCpa, isCurrency: true });
     });

     metrics.forEach(function(metric) {
            var baselineValid = false;

                           // Minimum volume thresholds to prevent spam/false alarms on tiny numbers
                           if (metric.name === "Cost" && metric.prior > 100) baselineValid = true;
            if (metric.name === "CTR" && metric.prior > 0.005) baselineValid = true;
            if (metric.name === "Avg CPC" && metric.prior > 0) baselineValid = true;
            if (metric.name === "All Conversions" && metric.prior >= 3) baselineValid = true;
            if (metric.name === "Cost / All Conversions" && metric.prior > 0 && metric.current > 0) baselineValid = true;
            if (metric.name.indexOf("Conv:") === 0 && metric.prior >= 3) baselineValid = true;
            if (metric.name.indexOf("CPA:") === 0 && metric.prior > 0 && metric.current > 0) baselineValid = true;

                           if (baselineValid) {
                                    var pctChange = (metric.current - metric.prior) / metric.prior;

              if (Math.abs(pctChange) >= threshold) {
                         var direction = pctChange > 0 ? "Increase" : "Decrease";

                                      var formatVal = function(val, item) {
                                                   if (item.isCurrency) return "$" + val.toFixed(2);
                                                   if (item.isPercent) return (val * 100).toFixed(2) + "%";
                                                   return val.toFixed(1);
                                      };

                                      var chartLabel = campName + " (" + metric.name + ")";

                                      anomaliesArray.push([
                                                   campName,
                                                   metric.name,
                                                   direction + " (" + (pctChange * 100).toFixed(1) + "%)",
                                                   formatVal(metric.current, metric),
                                                   formatVal(metric.prior, metric),
                                                   new Date(),
                                                   pctChange,   // Col G: For the Chart Values
                                                   chartLabel   // Col H: For the Clean Chart Labels
                                                 ]);
              }
                           }
     });
  }
}

// Helper function to pull specific conversion actions via GAQL
function getSpecificConversionData(startDate, endDate) {
   var query = "SELECT campaign.name, segments.conversion_action_name, metrics.conversions " +
                  "FROM campaign " +
                  "WHERE campaign.status = 'ENABLED' " +
                  "AND segments.date BETWEEN '" + startDate + "' AND '" + endDate + "'";

  var report = AdsApp.report(query);
   var rows = report.rows();
   var data = {};

  while (rows.hasNext()) {
       var row = rows.next();
       var campName = row["campaign.name"];
       var convName = row["segments.conversion_action_name"];

     var rawConvs = row["metrics.conversions"];
       var convs = 0;
       if (rawConvs) {
              convs = parseFloat(rawConvs.toString().replace(/,/g, ''));
       }

     if (!data[campName]) {
            data[campName] = {};
     }
       if (!data[campName][convName]) {
              data[campName][convName] = 0;
       }
       data[campName][convName] += convs;
  }
   return data;
}

// Function to generate the Google Sheet Dashboard
function writeAnomaliesToSheet(ss, tabName, priorTabName, anomalies) {
   var sheet = ss.getSheetByName(tabName);
   if (!sheet) {
        sheet = ss.insertSheet(tabName);
        sheet.appendRow(["Campaign Name", "KPI Metric", "MoM Shift", tabName, priorTabName, "Timestamp Logged", "Raw Shift %", "Chart Label"]);
   }

  if (anomalies.length > 0) {
       sheet.getRange(sheet.getLastRow() + 1, 1, anomalies.length, 8).setValues(anomalies);
       sheet.hideColumns(7, 2); // Hide helper columns

     // ==========================================
     // BUILD DASHBOARD ELEMENTS IN SHEET
     // ==========================================

     sheet.getRange("I2").setValue("📊 SUMMARY OF FINDINGS").setFontWeight("bold").setFontSize(12);
       sheet.getRange("I3").setValue("We detected " + anomalies.length + " performance anomalies (MoM shifts >= 15%) across your active campaigns.");

     sheet.getRange("I5").setValue("✅ RECOMMENDED NEXT STEPS").setFontWeight("bold").setFontSize(12);
       sheet.getRange("I6").setValue("1. Review the campaigns with significant CPA or Cost increases to ensure budgets are being spent efficiently.");
       sheet.getRange("I7").setValue("2. Investigate any major drops in conversion volume to rule out tracking issues or landing page downtime.");
       sheet.getRange("I8").setValue("3. Check campaigns with large CTR or Conversion volume increases to see if ad copy or targeting changes drove the improvement.");

     var allSheets = ss.getSheets();
       var monthlyCounts = [];
       var monthRegex = /^[A-Z][a-z]+\s20\d{2}$/;

     for (var i = 0; i < allSheets.length; i++) {
            var sName = allSheets[i].getName();
            if (monthRegex.test(sName)) {
                     var rowCount = Math.max(0, allSheets[i].getLastRow() - 1);
                     var dateObj = new Date(sName);
                     if (!isNaN(dateObj.getTime())) {
                                monthlyCounts.push({name: sName, count: rowCount, date: dateObj});
                     }
            }
     }

     monthlyCounts.sort(function(a, b) { return a.date - b.date; });

     sheet.getRange("M1").setValue("Month");
       sheet.getRange("N1").setValue("Anomalies");
       for (var j = 0; j < monthlyCounts.length; j++) {
              sheet.getRange(j + 2, 13).setValue(monthlyCounts[j].name);
              sheet.getRange(j + 2, 14).setValue(monthlyCounts[j].count);
       }
       sheet.hideColumns(13, 2);

     var trendChart = sheet.newChart()
         .setChartType(Charts.ChartType.COLUMN)
         .addRange(sheet.getRange(1, 13, monthlyCounts.length + 1, 2))
         .setPosition(10, 9, 0, 0)
         .setOption('title', 'Total Anomalies Flagged by Month')
         .setOption('width', 450)
         .setOption('height', 350)
         .setOption('legend', {position: 'none'})
         .build();
       sheet.insertChart(trendChart);

     var originalChartBuilder = sheet.newChart()
         .setChartType(Charts.ChartType.BAR)
         .addRange(sheet.getRange(1, 1, anomalies.length + 1, 2))
         .addRange(sheet.getRange(1, 7, anomalies.length + 1, 1))
         .setPosition(10, 16, 0, 0)
         .setOption('title', 'Month-over-Month Performance Anomalies')
         .setOption('width', 600)
         .setOption('height', 400)
         .setOption('legend', {position: 'none'})
         .build();

     sheet.insertChart(originalChartBuilder);

     Logger.log("Google Sheet updated and dashboard created for tab: " + tabName);
  } else {
       sheet.getRange("I2").setValue("📊 SUMMARY OF FINDINGS").setFontWeight("bold").setFontSize(12);
       sheet.getRange("I3").setValue("No significant anomalies (MoM shifts >= 15%) were detected for the last completed month.");
       sheet.getRange("I5").setValue("✅ RECOMMENDED NEXT STEPS").setFontWeight("bold").setFontSize(12);
       sheet.getRange("I6").setValue("No immediate action is required. Continue monitoring performance as usual.");
       Logger.log("No new anomalies found to log today.");
  }
}

// Function to send the automated email alert
function sendEmailReport(recipients, anomalies, tabName, sheetUrl) {
   var subject = "Google Ads Anomaly Report - " + tabName;
   var body = "Hello Team,\n\n" +
                 "The Google Ads Anomaly Monthly Checker has completed its analysis.\n\n";

  if (anomalies.length > 0) {
       body += "📊 SUMMARY OF FINDINGS:\n";
       body += "We detected " + anomalies.length + " performance anomalies (MoM shifts >= 15%) across your active campaigns.\n\n";

     body += "✅ RECOMMENDED NEXT STEPS:\n";
       body += "1. Review the campaigns with significant CPA or Cost increases to ensure budgets are being spent efficiently.\n";
       body += "2. Investigate any major drops in conversion volume to rule out tracking issues or landing page downtime.\n";
       body += "3. Check campaigns with large CTR or Conversion volume increases to see if ad copy or targeting changes drove the improvement.\n\n";

     body += "You can view the full detailed list of anomalies and the visual dashboard here:\n" + sheetUrl + "\n\n";
  } else {
       body += "📊 SUMMARY OF FINDINGS:\n";
       body += "No significant anomalies (MoM shifts >= 15%) were detected for the last completed month.\n\n";

     body += "✅ RECOMMENDED NEXT STEPS:\n";
       body += "No immediate action is required. Continue monitoring performance as usual.\n\n";

     body += "Tracker Link:\n" + sheetUrl + "\n\n";
  }

  body += "Best,\nYour Automated Google Ads Script";

  var recipientString = recipients.join(",");
   MailApp.sendEmail(recipientString, subject, body);
   Logger.log("Email report sent to: " + recipientString);
}
