define("route-recognizer",
  [],
  function() {
    "use strict";
    var specials = [
      '/', '.', '*', '+', '?', '|',
      '(', ')', '[', ']', '{', '}', '\\'
    ];

    var escapeRegex = new RegExp('(\\' + specials.join('|\\') + ')', 'g');
    var queryRegex = '(?:;([^/]*))?';

    // A Segment represents a segment in the original route description.
    // Each Segment type provides an `eachChar` and `regex` method.
    //
    // The `eachChar` method invokes the callback with one or more character
    // specifications. A character specification consumes one or more input
    // characters.
    //
    // The `regex` method returns a regex fragment for the segment. If the
    // segment is a dynamic of star segment, the regex fragment also includes
    // a capture.
    //
    // A character specification contains:
    //
    // * `validChars`: a String with a list of all valid characters, or
    // * `invalidChars`: a String with a list of all invalid characters
    // * `repeat`: true if the character specification can repeat

    function StaticSegment(string) { this.string = string; }
    StaticSegment.prototype = {
      regex: function() {
        var r = this.string.replace(escapeRegex, '\\$1');
        return this.query ? r + queryRegex : r;
      },

      generate: function() {
        return this.string;
      }
    };

    function EpsilonSegment() {}
    EpsilonSegment.prototype = {
      // Currently only used for empty routes, to conveniently
      // apply a query regex to the last handler.
      regex: function() {
        return queryRegex;
      },

      generate: function() {
        return '';
      }
    };

    function DynamicSegment(name) { this.name = name; }
    DynamicSegment.prototype = {
      regex: function() {
        return this.query ? "([^/;]+)" + queryRegex : "([^/]+)";
      },

      generate: function(params) {
        return params[this.name];
      }
    };

    function StarSegment(name) { this.name = name; }
    StarSegment.prototype = {
      regex: function() {
        return this.query ? "([^;]+)" + queryRegex : "(.+)";
      },

      generate: function(params) {
        return params[this.name];
      }
    };

    function parse(route, names, types) {
      // normalize route as not starting with a "/". Recognition will
      // also normalize.
      if (route.charAt(0) === "/") { route = route.substr(1); }

      var segments = route.split("/"), results = [];

      for (var i=0, l=segments.length; i<l; i++) {
        var segment = segments[i], match;

        if (match = segment.match(/^:([^\/]+)$/)) {
          results.push(new DynamicSegment(match[1]));
          names.push(match[1]);
          types.dynamics++;
        } else if (match = segment.match(/^\*([^\/]+)$/)) {
          results.push(new StarSegment(match[1]));
          names.push(match[1]);
          types.stars++;
        } else if(segment === "") {
          // Ignore segment
        } else {
          results.push(new StaticSegment(segment));
          types.statics++;
        }
      }

      return results;
    }

    // A State has a character specification and (`charSpec`) and a list of possible
    // subsequent states (`nextStates`).
    //
    // If a State is an accepting state, it will also have several additional
    // properties:
    //
    // * `regex`: A regular expression that is used to extract parameters from paths
    //   that reached this accepting state.
    // * `handlers`: Information on how to convert the list of captures into calls
    //   to registered handlers with the specified parameters
    // * `types`: How many static, dynamic or star segments in this route. Used to
    //   decide which route to use if multiple registered routes match a path.
    //
    // Currently, State is implemented naively by looping over `nextStates` and
    // comparing a character specification against a character. A more efficient
    // implementation would use a hash of keys pointing at one or more next states.

    function State(segmentRegex) {
      this.segmentRegex = segmentRegex;
      this.nextStates = [];
    }

    State.prototype = {
      get: function(segmentRegex) {
        var nextStates = this.nextStates;

        for (var i=0, l=nextStates.length; i<l; i++) {
          var child = nextStates[i];
          if (child.segmentRegex === segmentRegex) { return child; }
        }
      },

      put: function(segmentRegex) {
        var state;
        segmentRegex = '^'+segmentRegex+'$';

        // If the character specification already exists in a child of the current
        // state, just return that state.
        if (state = this.get(segmentRegex)) { return state; }

        // Make a new state for the character spec
        state = new State(segmentRegex);

        // Insert the new state as a child of the current state
        this.nextStates.push(state);

        // Return the new state
        return state;
      },

      // Find a list of child states matching the next character
      match: function(segment) {
        var nextStates = this.nextStates, child;

        var returned = [];

        for (var i=0, l=nextStates.length; i<l; i++) {
          child = nextStates[i];

          if (segment.match(child.segmentRegex)) {
            returned.push(child);
          }
        }

        return returned;
      }
    };

    // This is a somewhat naive strategy, but should work in a lot of cases
    // A better strategy would properly resolve /posts/:id/new and /posts/edit/:id
    function sortSolutions(states) {
      return states.sort(function(a, b) {
        if (a.types.stars !== b.types.stars) { return a.types.stars - b.types.stars; }
        if (a.types.dynamics !== b.types.dynamics) { return a.types.dynamics - b.types.dynamics; }
        if (a.types.statics !== b.types.statics) { return a.types.statics - b.types.statics; }

        return 0;
      });
    }

    function recognizeSegment(states, segment) {
      var nextStates = [];

      for (var i=0, l=states.length; i<l; i++) {
        var state = states[i];

        nextStates = nextStates.concat(state.match(segment));
      }

      return nextStates;
    }

    /**
     * Parses a semicolon-separated query string into a key: value
     * object. Keys without values are interpreted as boolean flags
     * (i.e. their value will be a boolean "true").
     * @param {String} queryString
     * @returns {Object}
     */
    function deserializeQueryString(queryString) {
      var pairs = queryString.split(';'), i, l,
          pair, query = {};
      var r = function(str) {
        return str.replace('%3D', '=').replace('%3B', ';');
      };
      for (i = 0, l = pairs.length; i < l; i++) {
        pair = pairs[i].split("=");
        query[r(pair[0])] = pair.length > 1 ? r(pair[1]) : true;
      }
      return query;
    }

    /**
     * Serializes a query object into a Matrix-parameter
     * query string.
     * @param {Object} query
     * @returns {string}
     */
    function serializeQuery(query) {
      var str = [], r = function(str) {
        // Doubly encode separators (setting them won't always automatically URL-encode)
        return str.replace(';', '%253B').replace('=', '%253D');
      }, pair;
      for (var k in query) {
        pair = r(k);
        if (query[k]) {
          pair += '=' + r(query[k] + '');
        }
        str.push(pair);
      }
      return str.join(';');
    }

    function findHandler(state, path) {
      var handlers = state.handlers, regex = state.regex;
      var captures = path.match(regex), currentCapture = 1;
      var queryString, query;
      var result = [];

      for (var i=0, l=handlers.length; i<l; i++) {
        var handler = handlers[i], names = handler.names, params = {};

        for (var j=0, m=names.length; j<m; j++) {
          params[names[j]] = captures[currentCapture++];
        }

        if (handler.hasQuery) {
          queryString = captures[currentCapture++];
          query = queryString ? deserializeQueryString(queryString) : {};
        } else {
          query = {};
        }
        result.push({ handler: handler.handler, params: params,
          isDynamic: !!names.length, query: query });
      }

      return result;
    }

    // The main interface

    var RouteRecognizer = function() {
      this.rootState = new State();
      this.names = {};
    };


    RouteRecognizer.prototype = {
      add: function(routes, options) {
        var currentState = this.rootState, regex = "^",
            types = { statics: 0, dynamics: 0, stars: 0 },
            handlers = [], allSegments = [], name;

        var isEmpty = true;

        for (var i=0, l=routes.length; i<l; i++) {
          var route = routes[i], names = [];

          var segments = parse(route.path, names, types);

          allSegments = allSegments.concat(segments);

          for (var j=0, m=segments.length; j<m; j++) {
            var segment = segments[j],
                isLastSegment = ((j+1) === m),
                segmentRegex;

            isEmpty = false;

            // Allow a query string on every handler's last segment
            if (isLastSegment) {
              // Set the name of the handler for which this segment receives a query string
              segment.query = route.handler;
            }

            segmentRegex = segment.regex();
            regex += '/'+segmentRegex;
            currentState = currentState.put(segmentRegex);
          }

          handlers.push({ handler: route.handler, names: names });
        }

        if (isEmpty) {
          currentState = currentState.put('');
          // Add a query string to the leaf handler of an empty route
          var e = new EpsilonSegment(),
              lastHandler = handlers[handlers.length - 1];
          e.query = lastHandler.handler;
          regex += "/"+ e.regex();
          allSegments.push(e);
        }

        currentState.handlers = handlers;
        currentState.regex = new RegExp(regex + "$");
        currentState.types = types;

        if (name = options && options.as) {
          this.names[name] = {
            segments: allSegments,
            handlers: handlers
          };
        }
      },

      handlersFor: function(name) {
        var route = this.names[name], result = [];
        if (!route) { throw new Error("There is no route named " + name); }

        for (var i=0, l=route.handlers.length; i<l; i++) {
          result.push(route.handlers[i]);
        }

        return result;
      },

      hasRoute: function(name) {
        return !!this.names[name];
      },

      generate: function(name, params, queries) {
        var route = this.names[name], output = "", queryString;
        if (!route) { throw new Error("There is no route named " + name); }

        var segments = route.segments;

        for (var i=0, l=segments.length; i<l; i++) {
          var segment = segments[i];

          output += "/";
          output += segment.generate(params);

          if (segment.query && queries[segment.query] &&
                (queryString = serializeQuery(queries[segment.query]))) {
            output += ';'+queryString;
          }
        }

        if (output.charAt(0) !== '/') { output = '/' + output; }

        return output;
      },

      recognize: function(path) {
        var states = [ this.rootState ], i, l;

        // DEBUG GROUP path

        var pathLen = path.length;

        if (path.charAt(0) !== "/") { path = "/" + path; }

        if (pathLen > 1 && path.charAt(pathLen - 1) === "/") {
          path = path.substr(0, pathLen - 1);
        }

        var segments = path.split('/');

        // Start at i=1, ignoring the "empty" segment before the slash
        for (i=1, l=segments.length; i<l; i++) {
          states = recognizeSegment(states, segments[i]);
          if (!states.length) { break; }
        }

        // END DEBUG GROUP

        var solutions = [];
        for (i=0, l=states.length; i<l; i++) {
          if (states[i].handlers) { solutions.push(states[i]); }
        }

        sortSolutions(solutions);

        var state = solutions[0];

        if (state && state.handlers) {
          return findHandler(state, path);
        }
      }
    };

    function Target(path, matcher, delegate) {
      this.path = path;
      this.matcher = matcher;
      this.delegate = delegate;
    }

    Target.prototype = {
      to: function(target, callback) {
        var delegate = this.delegate;

        if (delegate && delegate.willAddRoute) {
          target = delegate.willAddRoute(this.matcher.target, target);
        }

        this.matcher.add(this.path, target);

        if (callback) {
          if (callback.length === 0) { throw new Error("You must have an argument in the function passed to `to`"); }
          this.matcher.addChild(this.path, target, callback, this.delegate);
        }
      }
    };

    function Matcher(target) {
      this.routes = {};
      this.children = {};
      this.target = target;
    }

    Matcher.prototype = {
      add: function(path, handler) {
        this.routes[path] = handler;
      },

      addChild: function(path, target, callback, delegate) {
        var matcher = new Matcher(target);
        this.children[path] = matcher;

        var match = generateMatch(path, matcher, delegate);

        if (delegate && delegate.contextEntered) {
          delegate.contextEntered(target, match);
        }

        callback(match);
      }
    };

    function generateMatch(startingPath, matcher, delegate) {
      return function(path, nestedCallback) {
        var fullPath = startingPath + path;

        if (nestedCallback) {
          nestedCallback(generateMatch(fullPath, matcher, delegate));
        } else {
          return new Target(startingPath + path, matcher, delegate);
        }
      };
    }

    function addRoute(routeArray, path, handler) {
      var len = 0;
      for (var i=0, l=routeArray.length; i<l; i++) {
        len += routeArray[i].path.length;
      }

      path = path.substr(len);
      routeArray.push({ path: path, handler: handler });
    }

    function eachRoute(baseRoute, matcher, callback, binding) {
      var routes = matcher.routes;

      for (var path in routes) {
        if (routes.hasOwnProperty(path)) {
          var routeArray = baseRoute.slice();
          addRoute(routeArray, path, routes[path]);

          if (matcher.children[path]) {
            eachRoute(routeArray, matcher.children[path], callback, binding);
          } else {
            callback.call(binding, routeArray);
          }
        }
      }
    }

    RouteRecognizer.prototype.map = function(callback, addRouteCallback) {
      var matcher = new Matcher();

      callback(generateMatch("", matcher, this.delegate));

      eachRoute([], matcher, function(route) {
        if (addRouteCallback) { addRouteCallback(this, route); }
        else { this.add(route); }
      }, this);
    };
    return RouteRecognizer;
  });
