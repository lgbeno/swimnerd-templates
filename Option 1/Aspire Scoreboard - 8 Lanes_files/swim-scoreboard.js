const client = new WebSocket("ws://localhost:8080/");
//var numberOfLanes = 10;
var timerIsRunning = false;

var numberOfLanes = document.getElementById("swimmingScript").getAttribute("numberOfLanes");
console.log("Number of Lanes: " + numberOfLanes); // to view the variable value

client.onerror = function() {
    console.log('Connection Error');
};

client.onopen = function() {
    console.log('WebSocket Client Connected');
};

client.onclose = function() {
    console.log('WebSocket Client Closed');
};

client.onmessage = function(e) {
    //console.log(e.data);
    var jsonData = JSON.parse(e.data);

    processRunningTime(jsonData);
    processEventName(jsonData);
    processLaneData(jsonData);
};

function setLaneTextArray() {
    for(let laneCounter = 0; laneCounter < numberOfLanes; laneCounter++) {
        laneText.push("");
    }
}

function processEventName(jsonData) {
    var eventVal = " E:" + jsonData.swimming.EventNumber + " H:" + jsonData.swimming.HeatNumber + " " + jsonData.swimming.EventName;
    
    if (timerIsRunning == true) {
        document.getElementById("eventName").innerHTML = eventVal;
        document.getElementById("eventNameSM").innerHTML = "";
    } else {
        document.getElementById("eventName").innerHTML = "";
        document.getElementById("eventNameSM").innerHTML = eventVal;
    }
}

function processRunningTime(jsonData) {
    if ((jsonData.swimming.RunningTime.trim() == ":  .") || (jsonData.swimming.RunningTime.trim() == ": 0.0") || (jsonData.swimming.RunningTime.trim() == "0.0")) {
        document.getElementById("runningTime").innerHTML = "";
        timerIsRunning = false;
    } else {
        document.getElementById("runningTime").innerHTML = jsonData.swimming.RunningTime;
        timerIsRunning = true;
    }
}

function processLaneData(jsonData) {
    for(let laneCounter = 0; laneCounter < numberOfLanes; laneCounter++) {
        var laneNum = laneCounter + 1;
        var laneVal = "";

        if (timerIsRunning == true) {
            if (jsonData.swimming.LaneAthleteTeam[laneCounter].LaneNumber.trim() == "") {
                // No data for this lane - it is turned off
                laneVal = "";
            } else {
                laneVal = processRunningLane(jsonData, laneCounter);
            }

            $("#athleteName-" + laneNum).show().text(laneVal);
            clearStoppedLanes(laneCounter);

        } else {
            // Timer has stopped - show all the lanes in the lower right corner
            processStoppedLane(jsonData, laneCounter);
            $("#athleteName-" + laneNum).show().text(""); // Clear all the overlay lanes
        }
    }
}

function processRunningLane(jsonData, laneCounter) {
    var laneVal = "";
    
    if ((jsonData.swimming.LaneAthleteTeam[laneCounter].SplitTime.trim() == ".") || (jsonData.swimming.LaneAthleteTeam[laneCounter].SplitTime.trim() == "")) {
        laneVal = "";
    } else {
        laneVal = " " + jsonData.swimming.LaneAthleteTeam[laneCounter].AthleteName;
        laneVal += " - " + jsonData.swimming.LaneAthleteTeam[laneCounter].Team;
        laneVal += " - (" + jsonData.swimming.LaneAthleteTeam[laneCounter].SplitTime + ")";
        
        if (jsonData.swimming.LaneAthleteTeam[laneCounter].Place !== " ") {
            laneVal += " " + jsonData.swimming.LaneAthleteTeam[laneCounter].FinalTime;
            laneVal += "  -  " + jsonData.swimming.LaneAthleteTeam[laneCounter].Place;
        }
    }

    return laneVal;
}

function processStoppedLane(jsonData, laneCounter) {
    var laneNum = laneCounter + 1;

    if (jsonData.swimming.LaneAthleteTeam[laneCounter].LaneNumber.trim() != "") {
        document.getElementById("laneNumberSM-" + laneNum).innerHTML = jsonData.swimming.LaneAthleteTeam[laneCounter].LaneNumber;
        document.getElementById("placeNumberSM-" + laneNum).innerHTML = jsonData.swimming.LaneAthleteTeam[laneCounter].Place;
        document.getElementById("athleteNameSM-" + laneNum).innerHTML = jsonData.swimming.LaneAthleteTeam[laneCounter].AthleteName;
        document.getElementById("teamNameSM-" + laneNum).innerHTML = jsonData.swimming.LaneAthleteTeam[laneCounter].Team;
        if (jsonData.swimming.LaneAthleteTeam[laneCounter].SplitTime.trim() == ".") {
            jsonData.swimming.LaneAthleteTeam[laneCounter].SplitTime = "";
        }
        document.getElementById("splitTimeSM-" + laneNum).innerHTML = jsonData.swimming.LaneAthleteTeam[laneCounter].SplitTime;
        document.getElementById("finalTimeSM-" + laneNum).innerHTML = jsonData.swimming.LaneAthleteTeam[laneCounter].FinalTime;
    }
}

function clearStoppedLanes(laneCounter) {
    var laneNum = laneCounter + 1;

    document.getElementById("laneNumberSM-" + laneNum).innerHTML = "";
    document.getElementById("placeNumberSM-" + laneNum).innerHTML = "";
    document.getElementById("athleteNameSM-" + laneNum).innerHTML = "";
    document.getElementById("teamNameSM-" + laneNum).innerHTML = "";
    document.getElementById("splitTimeSM-" + laneNum).innerHTML = "";
    document.getElementById("finalTimeSM-" + laneNum).innerHTML = "";
}