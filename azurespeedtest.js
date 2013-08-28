var http = require("http");
var https = require("https");
var express = require("express");
var _ = require("underscore");
var mapquest = require("mapquest");

var app = express();
var port = process.env.PORT || 8080;
app.use(express.bodyParser());
app.listen(port);

var twitterToken, refresh_url, lastGeocodeStatus;
var rawTweets;
var formattedTweets = [];
var dcs = [
	"West Europe",
	"Souteast Asia",
	"East Asia",
	"North Central US",
	"North Europe",
	"South Central US",
	"West US",
	"East US"
	];

app.get('/', function(req, res){
	res.sendfile(__dirname + '/AzureSpeedTestMap.html');
});

app.get('/locations', function(req, res){
	res.json(_.filter(formattedTweets, function(t){return t.geo != undefined}));
});

parseTweets = function(tweets){
	var ft = [];

	tweets.statuses.forEach(function(status){
		if(status.retweeted == false){
			var formatted = {};
			formatted.text = status.text;
			formatted.dc = parseDataCentre(status.text);
			formatted.latency = parseLatency(status.text);
			formatted.addr = status.user.location;
			formatted.geo = status.geo;

			if(formatted.dc){
				ft.push(formatted);
			}
		}
	});

	return ft;
}

parseLatency = function(tweet){
	var endIx = tweet.indexOf("ms)");
	var snippet = tweet.substring(endIx - 10, endIx); // in case "(" is used elsewhere in the tweet
	var startIx = snippet.indexOf("(") + 1;
	return snippet.substring(startIx, snippet.length);
}

parseDataCentre = function(tweet){
	var result;
	dcs.forEach(function(dc){
		if(tweet.indexOf(dc) != -1){
			result = dc;
		}
	});

	return result;
}

geocodeAddresses = function(i){
	if(i < formattedTweets.length){
		var ft = formattedTweets[i];
		if(ft.addr && !ft.geo){
			// Throttle the calls to geocoding api so we don't hit the query limit
			setTimeout(function(){
				geocodeGoogle(ft, i);
				//geocodeMapQuest(ft);
			}, 1000 * i);
		}
		geocodeAddresses(i+1);
	}
}

geocodeMapQuest = function(tweet){
	mapquest.geocode(tweet.addr, function(err, location){
		if(err){
			console.log("geocodeMapQuest Error: " + err);
		}
		else{
			if(location){
				console.log("geocodeMapQuest Response: " + location);
				tweet.geo = location.latLng;
			}
		}
	});
}

geocodeGoogle = function(tweet, i){
	var options = {
		host:'maps.googleapis.com',
		path:'/maps/api/geocode/json?sensor=false&address=' + encodeURI(tweet.addr),		
	};

	http.get(options, function(res){
		console.log("geocodeGoogle Response: " + res.statusCode);
		var data = '';
		res.on('data', function(chunk){
			data += chunk;
		});
		res.on('end', function(){
			console.log(data);
			var response = JSON.parse(data);
			if(response.status == "OK"){
				console.log(response.results[0]);
				tweet.geo = response.results[0].geometry.location;
			}
			else if(response.status == "ZERO_RESULTS"){
				formattedTweets.splice(i, 1);
			}

			lastGeocodeStatus = response.status;
		})
	}).on('error', function(e){
		console.log("geocodeGoogle Error: " + e.message);
	});
}

getToken = function(auth){
	var options = {
		host:'api.twitter.com',
		path:'/oauth2/token',
		method:'POST',
		headers: {
			'Authorization':'Basic ' + auth,
			'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'
		}
	};
	var req = https.request(options, onGetToken);
	req.on('error', function(error){
		console.log('getToken Error: ' + error);
	});
	req.write('grant_type=client_credentials');
	req.end();
}

onGetToken = function(res){
	res.on('data', function(chunk){
		console.log("getToken Response: " + chunk);
		twitterToken = JSON.parse(chunk);
		console.log("Twitter Token: " + twitterToken.access_token);

		setInterval(getTweets, 300000); // Refresh every five minutes
		getTweets();
	});
}

getTweets = function(){
	rawTweets = "";
	var query_string = refresh_url == undefined ?
		'?q=%23AzureSpeedTest&count=100&result_type=recent' :
		refresh_url;

	console.log("query_string: " + query_string);

	var options = {
		host: 'api.twitter.com',
		path: '/1.1/search/tweets.json' + query_string,
		headers: {
			'Authorization':'Bearer ' + twitterToken.access_token,
		}
	};

	https.get(options, function(res){
		console.log("getTweets Response: " + res.statusCode);
		res.on('data', function(chunk){
			rawTweets += chunk.toString('utf-8');
		});	
		res.on('end', function(){
			var tweets = JSON.parse(rawTweets);
			console.log(tweets);

			formattedTweets = formattedTweets.concat(parseTweets(tweets));

			// Limit to the latest 1000 tweets
			if(formattedTweets.length > 1000){
				formattedTweets.splice(1000, formattedTweets.length - 1000);
			}

			console.log("Loaded " + formattedTweets.length + " tweets");
			geocodeAddresses(0);

			refresh_url = tweets.search_metadata.refresh_url;
		})	
	}).on('error', function(e){
		console.log("getTweets Error: " + e.message);
	});
}

getToken(new Buffer(encodeURI('f8enoi8BcChm2rfEzFiUJQ') + ':' + encodeURI('MG0eCiSJAlcsrp68Xinm7xqhXuMWqF1SVXJBYV4g4Q')).toString('base64'));


