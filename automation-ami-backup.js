//Init AWS
var aws = require('aws-sdk');  
aws.config.region = 'ap-northeast-1'; //Change this to the region you like
var ec2 = new aws.EC2();  

//Variables for the script
//Changes below are not required but if you do change, then change to match delete and create lambda scripts.
const keyForEpochMakerinAMI = "DATETODEL-";
const keyForInstanceTagToBackup = "Backup"; //looks for string yes
const keyForInstanceTagDurationBackup = "BackupRetentionDays"; //accepts numbers like 5 or 10 or 22 and so on.
const keyForInstanceTagScheduledDays = "BackupSchedule"; //accepts day of week * / 0,1,2,3,4,5,6
const keyForInstanceTagNoReboot = "NoReboot"; //if true then it wont reboot. If not present or set to false then it will reboot.


// Function for posting to Slack
function postToSlack(messageText){
const https = require('https');
const url = require('url');
// to get the slack hook url, go into slack admin and create a new "Incoming Webhook" integration
// TODO
const slack_url = 'https://hooks.slack.com/services/xxxxxxxxxxxxxxx'; //slack channel for notification
const slack_req_opts = url.parse(slack_url);
slack_req_opts.method = 'POST';
slack_req_opts.headers = {'Content-Type': 'application/json'};

var req = https.request(slack_req_opts, function (res) {
        if (res.statusCode === 200) {
          console.log("Message posted to slack");
        } else {
          console.log("Error status code: " + res.statusCode);
        }
      });
      
      req.on('error', function(e) {
        console.log("problem with request: " + e.message);
        console.log(e.message);
      });
      
      req.write(JSON.stringify({text: messageText}));
      req.end();

}


//returns true or false based on tag value 
function checkIfBackupNeedsToRunToday(tagScheduleDays){
    tagScheduleDays = tagScheduleDays.trim(); //just removing accidental spaces by user.
        if(tagScheduleDays === "*"){
            return true; //all days so go ahead
        }

    var today=new Date();
    var dayOfWeek = today.getDay(); //this will be 0 for Sunday and upto 6 for Saturday.
    console.log("Should system process today? " + tagScheduleDays.includes(dayOfWeek));
    return tagScheduleDays.includes(dayOfWeek);
}

//Lambda handler
exports.handler = function(event, context) { 
    
    var instanceparams = {
        Filters: [{
            Name: 'tag:' + keyForInstanceTagToBackup,
            Values: [
                'yes'
            ]
        }]
    };
    
    ec2.describeInstances(instanceparams, function(err, data) {
        if (err) console.log(err, err.stack);
        else {
            for (var i in data.Reservations) {
                for (var j in data.Reservations[i].Instances) {
                    var instanceid = data.Reservations[i].Instances[j].InstanceId;
                    var name = "", backupRetentionDaysforAMI = -1, backupRunTodayCheck = "", noReboot = false;
                    for (var k in data.Reservations[i].Instances[j].Tags) {
                        if (data.Reservations[i].Instances[j].Tags[k].Key == 'Name') {
                            name = data.Reservations[i].Instances[j].Tags[k].Value;
                        }
                        if(data.Reservations[i].Instances[j].Tags[k].Key == keyForInstanceTagDurationBackup){
                            backupRetentionDaysforAMI = parseInt(data.Reservations[i].Instances[j].Tags[k].Value);
                        }
                        if(data.Reservations[i].Instances[j].Tags[k].Key == keyForInstanceTagScheduledDays){
                            backupRunTodayCheck = data.Reservations[i].Instances[j].Tags[k].Value;
                        }         
                        if(data.Reservations[i].Instances[j].Tags[k].Key == keyForInstanceTagNoReboot){
                            if(data.Reservations[i].Instances[j].Tags[k].Value == "true"){
                                noReboot = true;
                            }
                        }                        
                    }
                    //cant find when to delete then dont proceed.
                    if((backupRetentionDaysforAMI < 1) || (checkIfBackupNeedsToRunToday(backupRunTodayCheck) === false)){
                        console.log("Skipping instance Name: " + name + " backupRetentionDaysforAMI: " + backupRetentionDaysforAMI + " backupRunTodayCheck: " + backupRunTodayCheck + " checkIfBackupNeedsToRunToday:" + checkIfBackupNeedsToRunToday(backupRunTodayCheck) + " (backupRetentionDaysforAMI > 0)" + (backupRetentionDaysforAMI > 0));
                    }else{
                        console.log("Processing instance Name: " + name + " backupRetentionDaysforAMI: " + backupRetentionDaysforAMI + " backupRunTodayCheck: " + backupRunTodayCheck + " checkIfBackupNeedsToRunToday:" + checkIfBackupNeedsToRunToday(backupRunTodayCheck) + " (backupRetentionDaysforAMI > 0)" + (backupRetentionDaysforAMI > 0));                        
                        var genDate = new Date();  
                        genDate.setDate(genDate.getDate() + backupRetentionDaysforAMI); //days that are required to be held
                        var imageparams = {
                            InstanceId: instanceid,
                            Name: name + "_" + keyForEpochMakerinAMI + genDate.getTime(),
                            // NoReboot: true - Decided based on parameter from tag
                        };
                        if(noReboot == true){
                            imageparams["NoReboot"] = true;
                        }
                        console.log(imageparams);
                        ec2.createImage(imageparams, function(err, data) {
                            if (err){// error handle
                              postToSlack(":exclamation: There are errors while creating AMIs" + "\n" + err);
                              console.log(err, err.stack);  
                            } 
                            else {
                                image = data.ImageId;
                                console.log(image);
                                var tagparams = {
                                    Resources: [image],
                                    Tags: [{
                                        Key: 'DeleteBackupsAutoOn',
                                        Value: 'yes'
                                    }]
                                };
                                ec2.createTags(tagparams, function(err, data) {
                                    if (err){// add tags error handle
                                      console.log(err, err.stack);  
                                      postToSlack(":exclamation: There are errors while add tag for created AMIs" + "\n" + err);
                                    } 
                                    else console.log("Tags added to the created AMIs");
                                });
                                // TODO
                                // postToSlack(":white_check_mark: AMIs are created");
                            }
                        });
                    }
                }
            }
        }
    });
}
