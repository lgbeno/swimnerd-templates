const client = new WebSocket("ws://localhost:8080/");

var numberOfLanes = document.getElementById("swimmingScript").getAttribute("numberOfLanes");
console.log("Number of Lanes: " + numberOfLanes); // to view the variable value

client.onerror = function() {
    console.log('Connection Error');
};

client.onopen = function() {
    console.log('WebSocket Client Connected');
    clearLaneData();
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

function processEventName(jsonData) {
    var eventNumberHeatNumber = " Event:" + jsonData.swimming.EventNumber + " Heat:" + jsonData.swimming.HeatNumber;
    document.getElementById("eventNumberHeatNumber").innerHTML = eventNumberHeatNumber;
    document.getElementById("eventName").innerHTML = jsonData.swimming.EventName;
}

function processRunningTime(jsonData) {
    document.getElementById("runningTime").innerHTML = jsonData.swimming.RunningTime;
}

function clearLaneData(jsonData) {
    for(let laneCounter = 0; laneCounter < numberOfLanes; laneCounter++) {
        clearLane(laneCounter);
    }
}

function processLaneData(jsonData) {
    for(let laneCounter = 0; laneCounter < numberOfLanes; laneCounter++) {
        processLane(jsonData, laneCounter);
    }
}

function processLane(jsonData, laneCounter) {
    var laneNum = laneCounter + 1;

    if (jsonData.swimming.LaneAthleteTeam[laneCounter].LaneNumber.trim() != "") {
        //document.getElementById("laneNumber-" + laneNum).innerHTML = jsonData.swimming.LaneAthleteTeam[laneCounter].LaneNumber;
        document.getElementById("placeNumber-" + laneNum).innerHTML = jsonData.swimming.LaneAthleteTeam[laneCounter].Place;
        document.getElementById("athleteName-" + laneNum).innerHTML = jsonData.swimming.LaneAthleteTeam[laneCounter].AthleteName;
        document.getElementById("teamName-" + laneNum).innerHTML = jsonData.swimming.LaneAthleteTeam[laneCounter].Team;
        if (jsonData.swimming.LaneAthleteTeam[laneCounter].SplitTime.trim() == ".") {
            jsonData.swimming.LaneAthleteTeam[laneCounter].SplitTime = "&nbsp;";
        }
        document.getElementById("splitTime-" + laneNum).innerHTML = jsonData.swimming.LaneAthleteTeam[laneCounter].SplitTime;
        document.getElementById("finalTime-" + laneNum).innerHTML = jsonData.swimming.LaneAthleteTeam[laneCounter].FinalTime;
    }
}

function clearLane(laneCounter) {
    var laneNum = laneCounter + 1;

    //document.getElementById("laneNumber-" + laneNum).innerHTML = "&nbsp;";
    document.getElementById("placeNumber-" + laneNum).innerHTML = "&nbsp;";
    document.getElementById("athleteName-" + laneNum).innerHTML = "&nbsp;";
    document.getElementById("teamName-" + laneNum).innerHTML = "&nbsp;";
    document.getElementById("splitTime-" + laneNum).innerHTML = "&nbsp;";
    document.getElementById("finalTime-" + laneNum).innerHTML = "&nbsp;";
}