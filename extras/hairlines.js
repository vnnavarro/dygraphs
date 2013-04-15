/**
 * @license
 * Copyright 2013 Dan Vanderkam (danvdk@gmail.com)
 * MIT-licensed (http://opensource.org/licenses/MIT)
 *
 * Note: This plugin requires jQuery and jQuery UI Draggable.
 */

/*global Dygraph:false */

var allHairlines = [];

Dygraph.Plugins.Hairlines = (function() {

"use strict";

/**
 * xFraction is the position of the hairline on the chart, where 0.0=left edge
 * of the chart area and 1.0=right edge. Unlike 'canvas' coordinates, it does
 * not include the y-axis labels.
 *
 * @typedef {
 *   xFraction: number,   // invariant across resize
 *   interpolated: bool,  // alternative is to snap to closest
 *   lineDiv: !Element    // vertical hairline div
 *   infoDiv: !Element    // div containing info about the nearest points
 * } Hairline
 */

// We have to wait a few ms after clicks to give the user a chance to
// double-click to unzoom. This sets that delay period.
var CLICK_DELAY_MS = 300;

var hairlines = function() {
  /* @type {!Array.<!Hairline>} */
  this.hairlines_ = [];

  // Used to detect resizes (which require the divs to be repositioned).
  this.lastWidth_ = -1;
  this.lastHeight = -1;
  this.dygraph_ = null;

  this.addTimer_ = null;
};

hairlines.prototype.toString = function() {
  return "Hairlines Plugin";
};

hairlines.prototype.activate = function(g) {
  this.dygraph_ = g;
  this.hairlines_ = [this.createHairline(0.55)];

  return {
    didDrawChart: this.didDrawChart,
    click: this.click,
    dblclick: this.dblclick
  };
};

hairlines.prototype.detachLabels = function() {
  for (var i = 0; i < this.hairlines_.length; i++) {
    var h = this.hairlines_[i];
    $(h.lineDiv).remove();
    $(h.infoDiv).remove();
    this.hairlines_[i] = null;
  }
  this.hairlines_ = [];
};

hairlines.prototype.hairlineWasDragged = function(h, event, ui) {
  var area = this.dygraph_.getArea();
  h.xFraction = (ui.position.left - area.x) / area.w;
  this.moveHairlineToTop(h);
  this.updateHairlineDivPositions();
  this.updateHairlineInfo();
};

// This creates the hairline object and returns it.
// It does not position it and does not attach it to the chart.
hairlines.prototype.createHairline = function(xFraction) {
  var h;
  var self = this;

  var $lineContainerDiv = $('<div/>').css({
      'width': '6px',
      'margin-left': '-3px',
      'position': 'absolute',
      'z-index': '10'
    })
    .addClass('dygraph-hairline');

  var $lineDiv = $('<div/>').css({
    'width': '1px',
    'position': 'relative',
    'left': '3px',
    'background': 'black',
    'height': '100%'
  });
  $lineDiv.appendTo($lineContainerDiv);

  var $infoDiv = $('#hairline-template').clone().removeAttr('id').css({
      'position': 'absolute'
    })
    .show();

  // Surely there's a more jQuery-ish way to do this!
  $([$infoDiv.get(0), $lineContainerDiv.get(0)])
    .draggable({
      'axis': 'x',
      'drag': function(event, ui) {
        self.hairlineWasDragged(h, event, ui);
      }
      // TODO(danvk): set cursor here
    });

  h = {
    xFraction: xFraction,
    interpolated: true,
    lineDiv: $lineContainerDiv.get(0),
    infoDiv: $infoDiv.get(0)
  };

  var that = this;
  $infoDiv.on('click', '.hairline-kill-button', function() {
    that.removeHairline(h);
  });

  return h;
};

// Moves a hairline's divs to the top of the z-ordering.
hairlines.prototype.moveHairlineToTop = function(h) {
  var div = this.dygraph_.graphDiv;
  $(h.infoDiv).appendTo(div);
  $(h.lineDiv).appendTo(div);

  var idx = this.hairlines_.indexOf(h);
  this.hairlines_.splice(idx, 1);
  this.hairlines_.push(h);
};

// Positions existing hairline divs.
hairlines.prototype.updateHairlineDivPositions = function() {
  var layout = this.dygraph_.getArea();
  var div = this.dygraph_.graphDiv;
  var box = [layout.x + Dygraph.findPosX(div),
             layout.y + Dygraph.findPosY(div)];
  box.push(box[0] + layout.w);
  box.push(box[1] + layout.h);

  $.each(this.hairlines_, function(idx, h) {
    var left = layout.x + h.xFraction * layout.w;
    $(h.lineDiv).css({
      'left': left + 'px',
      'top': layout.y + 'px',
      'height': layout.h + 'px'
    });  // .draggable("option", "containment", box);
    $(h.infoDiv).css({
      'left': left + 'px',
      'top': layout.y + 'px',
    }).draggable("option", "containment", box);
  });
};

// Fills out the info div based on current coordinates.
hairlines.prototype.updateHairlineInfo = function() {
  var mode = 'closest';

  var g = this.dygraph_;
  var xRange = g.xAxisRange();
  $.each(this.hairlines_, function(idx, h) {
    var xValue = h.xFraction * (xRange[1] - xRange[0]) + xRange[0];

    var row = null;
    if (mode == 'closest') {
      // TODO(danvk): make this dygraphs method public
      row = g.findClosestRow(g.toDomXCoord(xValue));
    } else if (mode == 'interpolate') {
      // ...
    }

    // To use generateLegendHTML, we have to synthesize an array of selected
    // points.
    var selPoints = [];
    var labels = g.getLabels();
    for (var i = 1; i < g.numColumns(); i++) {
      selPoints.push({
        canvasx: 1,
        canvasy: 1,
        xval: xValue,
        yval: g.getValue(row, i),
        name: labels[i]
      });
    }

    var html = Dygraph.Plugins.Legend.generateLegendHTML(g, xValue, selPoints, 10);
    $('.hairline-legend', h.infoDiv).html(html);
  });
};

// After a resize, the hairline divs can get dettached from the chart.
// This reattaches them.
hairlines.prototype.attachHairlinesToChart_ = function() {
  var div = this.dygraph_.graphDiv;
  $.each(this.hairlines_, function(idx, h) {
    $([h.lineDiv, h.infoDiv]).appendTo(div);
  });
};

// Deletes a hairline and removes it from the chart.
hairlines.prototype.removeHairline = function(h) {
  var idx = this.hairlines_.indexOf(h);
  if (idx >= 0) {
    this.hairlines_.splice(idx, 1);
    $([h.lineDiv, h.infoDiv]).remove();
  } else {
    Dygraph.warn('Tried to remove non-existent hairline.');
  }
};

hairlines.prototype.didDrawChart = function(e) {
  var g = e.dygraph;

  allHairlines = this.hairlines_;

  // Early out in the (common) case of zero hairlines.
  if (this.hairlines_.length === 0) return;

  // TODO(danvk): recreate the hairline divs when the chart resizes.
  var containerDiv = e.canvas.parentNode;
  var width = containerDiv.offsetWidth;
  var height = containerDiv.offsetHeight;
  if (width !== this.lastWidth_ || height !== this.lastHeight_) {
    this.lastWidth_ = width;
    this.lastHeight_ = height;
    this.updateHairlineDivPositions();
    this.attachHairlinesToChart_();
  }

  this.updateHairlineInfo();
};

hairlines.prototype.click = function(e) {
  if (this.addTimer_) {
    // Another click is in progress; ignore this one.
    return;
  }

  var area = e.dygraph.getArea();
  var xFraction = (e.canvasx - area.x) / area.w;

  var that = this;
  this.addTimer_ = setTimeout(function() {
    that.addTimer_ = null;
    that.hairlines_.push(that.createHairline(xFraction));

    that.updateHairlineDivPositions();
    that.updateHairlineInfo();
    that.attachHairlinesToChart_();
  }, CLICK_DELAY_MS);
};

hairlines.prototype.dblclick = function(e) {
  if (this.addTimer_) {
    clearTimeout(this.addTimer_);
    this.addTimer_ = null;
  }
};

hairlines.prototype.destroy = function() {
  this.detachLabels();
};

return hairlines;

})();