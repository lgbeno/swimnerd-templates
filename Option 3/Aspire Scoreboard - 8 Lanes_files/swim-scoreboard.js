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

    for(let i = 0; i < numberOfLanes; i++) {
        clearLane(i);
    }
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
    document.getElementById("eventName").innerHTML = eventVal;
}

function processRunningTime(jsonData) {
    if ((jsonData.swimming.RunningTime.trim() == ":  .") || (jsonData.swimming.RunningTime.trim() == ": 0.0") || (jsonData.swimming.RunningTime.trim() == "0.0")) {
        document.getElementById("runningTime").innerHTML = "0.0";
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

        processLane(jsonData, laneCounter);
    }
}

function processLane(jsonData, laneCounter) {
    var laneNum = laneCounter + 1;

    if (jsonData.swimming.LaneAthleteTeam[laneCounter].LaneNumber.trim() != "") {
        document.getElementById("laneNumber-" + laneNum).innerHTML = jsonData.swimming.LaneAthleteTeam[laneCounter].LaneNumber;
        document.getElementById("placeNumber-" + laneNum).innerHTML = jsonData.swimming.LaneAthleteTeam[laneCounter].Place;
        document.getElementById("athleteName-" + laneNum).innerHTML = jsonData.swimming.LaneAthleteTeam[laneCounter].AthleteName;
        document.getElementById("teamName-" + laneNum).innerHTML = jsonData.swimming.LaneAthleteTeam[laneCounter].Team;
        if (jsonData.swimming.LaneAthleteTeam[laneCounter].SplitTime.trim() == ".") {
            jsonData.swimming.LaneAthleteTeam[laneCounter].SplitTime = "";
        }
        document.getElementById("splitTime-" + laneNum).innerHTML = jsonData.swimming.LaneAthleteTeam[laneCounter].SplitTime;
        document.getElementById("finalTime-" + laneNum).innerHTML = jsonData.swimming.LaneAthleteTeam[laneCounter].FinalTime;
    }
    else {
        clearLane(laneCounter);
    }
}

function clearLane(laneCounter) {
    var laneNum = laneCounter + 1;

    document.getElementById("laneNumber-" + laneNum).innerHTML = laneNum;
    document.getElementById("placeNumber-" + laneNum).innerHTML = "";
    document.getElementById("athleteName-" + laneNum).innerHTML = "";
    document.getElementById("teamName-" + laneNum).innerHTML = "";
    document.getElementById("splitTime-" + laneNum).innerHTML = "";
    document.getElementById("finalTime-" + laneNum).innerHTML = "";
}