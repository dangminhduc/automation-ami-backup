var aws = require('aws-sdk');  
aws.config.region = 'ap-northeast-1'; //Change this to the region you like
var ec2 = new aws.EC2();  

//Variables for the script
//Changes below are not required but if you do change, then change to match delete and create lambda scripts.
const keyForEpochMakerinAMI = "DATETODEL-";
const keyForAMIsToDelete = "DeleteBackupsAutoOn"; 

//Epoch time from the AMI name is used to check if deletion is required.
//Epoch time is used as it passes AWS AMI naming allowed patterns

// Function for posting to Slack
function postToSlack(messageText){
const https = require('https');
const url = require('url');
// to get the slack hook url, go into slack admin and create a new "Incoming Webhook" integration
// TODO
const slack_url = 'https://hooks.slack.com/services/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; //slack channel for notification
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

function checkIfAMIneedsDeleting(imagename){
    //Extract deletion date & time from image name 
    var epochImageDeleteDate = parseInt(imagename.substr(imagename.indexOf(keyForEpochMakerinAMI) + keyForEpochMakerinAMI.length));
    //Changing slightly so delete and create can run on same cloudwatch scheduled event
    //20 minutes = 20 * 60 seconds * 1000 milliseconds
    epochImageDeleteDate = epochImageDeleteDate - (20 * 60 * 1000);
    
    var genTimeNow = new Date(); 

    //check if epoch time for deletion has been reached
    if(epochImageDeleteDate > 0 && epochImageDeleteDate > genTimeNow.getTime()){
        // postToSlack("Not yet time to delete"+imagename);
        console.log("Not yet time to delete " + imagename);
        return false; //not yet time to delete
    }else if(epochImageDeleteDate > 0){
        // postToSlack("Time to delete " + imagename);
        console.log("Time to delete " + imagename);
        return true;
    }

    return false;
}

//Lambda handler
exports.handler = function(event, context) {  
ec2.describeImages({  
    Owners: [
        'self'
    ],
    Filters: [{
        Name: 'tag:' + keyForAMIsToDelete,
        Values: [
            'yes'
        ]
    }]

}, function(err, data) {
    if (err){ //error handling
        postToSlack(":exclamation: There is an error while deregistering AMI" + "\n" + err);
        console.log(err, err.stack);
    }
    else {
        for (var j in data.Images) {
            imagename = data.Images[j].Name
            imageid = data.Images[j].ImageId

            if (checkIfAMIneedsDeleting(imagename) === true) {
                console.log("image that is going to be deregistered: ", imagename);
                console.log("image id: ", imageid);

                var deregisterparams = {
                    ImageId: imageid
                };
                console.log(deregisterparams);
                ec2.deregisterImage(deregisterparams, function(err, data01) {
                    if (err) { //error handling
                        postToSlack(":exclamation: There is an error while deregistering AMI:" + imageid + "\n" + err);
                        console.log(err, err.stack); 
                    }
                    else { //AMI is successfully deregistered    TODO
                        // postToSlack(":white_check_mark: Image Deregistered: " + imageid);
                        console.log("Image Deregistered");
                    }
                });
            }
        }
        setTimeout(function() {
            for (var j in data.Images) {
                imagename = data.Images[j].Name
                if (checkIfAMIneedsDeleting(imagename) === true) {
                    for (var k in data.Images[j].BlockDeviceMappings) {
                        snap = data.Images[j].BlockDeviceMappings[k].Ebs.SnapshotId;
                        console.log(snap);
                        var snapparams = {
                            SnapshotId: snap
                        };
                        ec2.deleteSnapshot(snapparams, function(err, data) {
                            if (err){// error handle
                              postToSlack(":exclamation: There is an error while deleting snapshot: " + snapparams + "\n" + err);
                              console.log(err, err.stack);   
                            } 
                            else{// successful response  TODO
                            //   postToSlack("Snapshot " + snapparams +" deleted");
                              console.log("Snapshot " + snapparams +" deleted"); 
                            } 
                        });
                    }
                }
            }
        }, 10000);
    }
});
}
