import Feature from 'ol/Feature.js';
import { circular } from 'ol/geom/Polygon';
import OSM from 'ol/source/OSM';
import GeoJSON from 'ol/format/GeoJSON.js';
import ImageTile from 'ol/source/ImageTile.js';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import monotoneChainConvexHull from 'monotone-chain-convex-hull';
import {
  Circle as CircleStyle,
  Fill,
  Icon,
  Stroke,
  Style,
  Text,
} from 'ol/style.js';
import { Cluster, Vector as VectorSource } from 'ol/source.js';
import { LineString, Point, Polygon } from 'ol/geom.js';
import { Tile as TileLayer, Vector as VectorLayer } from 'ol/layer.js';
import { createEmpty, extend, getHeight, getWidth } from 'ol/extent.js';
import { fromLonLat } from 'ol/proj.js';
import { MapboxVectorLayer } from 'ol-mapbox-style';
import Control from 'ol/control/Control';

const circleDistanceMultiplier = 1;
const circleFootSeparation = 28;
const circleStartAngle = Math.PI / 2;

//Red
const convexHullFillLarge = new Fill({
  color: 'rgba(255, 53, 10, 0.4)',
});

//Yellow
const convexHullFillMedium = new Fill({
  color: 'rgba(0, 161, 0, 0.4)',
});

//Blue 
const convexHullFillSmall = new Fill({
  color: 'rgba(0, 53, 255, 0.4)',
});

//Red
const convexHullStrokeLarge = new Stroke({
  color: 'rgba(255, 53, 10, .7)',
  width: 1.5,
});

//Green
const convexHullStrokeMedium = new Stroke({
  color: 'rgba(0, 191, 0, .7)',
  width: 1.5,
});

//Blue 
const convexHullStrokeSmall = new Stroke({
  color: 'rgba(0, 53, 255, .7)',
  width: 1.5,
});

//Red
const outerCircleFillLarge = new Fill({
  color: 'rgba(255, 53, 10, 0.3)',
});
const innerCircleFillLarge = new Fill({
  color: 'rgba(255, 65, 10, 0.7)',
});

//Yellow
const outerCircleFillMedium = new Fill({
  color: 'rgba(255, 153, 102, 0.3)',
});
const innerCircleFillMedium = new Fill({
  color: 'rgba(255, 165, 102, 0.7)',
});

//Blue
const outerCircleFillSmall = new Fill({
  color: 'rgba(0, 53, 255, 0.3)',
});
const innerCircleFillSmall = new Fill({
  color: 'rgba(0, 53, 255, 0.7)',
});
const textFill = new Fill({
  color: '#fff',
});
const textStroke = new Stroke({
  color: 'rgba(0, 0, 0, 0.6)',
  width: 3,
});

const innerCircleLarge = new CircleStyle({
  radius: 5,
  fill: innerCircleFillLarge,
});
const outerCircleLarge = new CircleStyle({
  radius: 13,
  fill: outerCircleFillLarge,
});

const innerCircleMedium = new CircleStyle({
  radius: 5,
  fill: innerCircleFillMedium,
});
const outerCircleMedium = new CircleStyle({
  radius: 13,
  fill: outerCircleFillMedium,
});

const innerCircleSmall = new CircleStyle({
  radius: 5,
  fill: innerCircleFillSmall,
});
const outerCircleSmall = new CircleStyle({
  radius: 13,
  fill: outerCircleFillSmall,
});

/*const innerCircle = new CircleStyle({
  radius: 4,
  fill: innerCircleFillSmall,
});
const outerCircle = new CircleStyle({
  radius: 10,
  fill: outerCircleFillSmall,
}); */

const mapIcon = new Icon({
  src: './data/marker-icon.png',
});


/**
 * Single feature style, users for clusters with 1 feature and cluster circles.
 * @param {Feature} clusterMember A feature from a cluster.
 * @return {Style} An icon style for the cluster member's location.
 */
function clusterMemberStyle(clusterMember) {
  return new Style({
    geometry: clusterMember.getGeometry(),
    image: mapIcon,
  });
}

let clickFeature, clickResolution;
/**
 * Style for clusters with features that are too close to each other, activated on click.
 * @param {Feature} cluster A cluster with overlapping members.
 * @param {number} resolution The current view resolution.
 * @return {Style|null} A style to render an expanded view of the cluster members.
 */
function clusterCircleStyle(cluster, resolution) {
  if (cluster !== clickFeature || resolution !== clickResolution) {
    return null;
  }
  const clusterMembers = cluster.get('features');
  const centerCoordinates = cluster.getGeometry().getCoordinates();

  let convexHullStroke;
  if (clusterMembers.length <= 5) {
    convexHullStroke = convexHullStrokeSmall;
  } else if (clusterMembers.length >= 5 && clusterMembers.length <= 10) {
    convexHullStroke = convexHullStrokeMedium;
  } else {
    convexHullStroke = convexHullStrokeLarge;
  }

  return generatePointsCircle(
    clusterMembers.length,
    cluster.getGeometry().getCoordinates(),
    resolution,
  ).reduce((styles, coordinates, i) => {
    const point = new Point(coordinates);
    const line = new LineString([centerCoordinates, coordinates]);
    styles.unshift(
      new Style({
        geometry: line,
        stroke: convexHullStroke,
      }),
    );
    styles.push(
      clusterMemberStyle(
        new Feature({
          ...clusterMembers[i].getProperties(),
          geometry: point,
        }),
      ),
    );
    return styles;
  }, []);
}

/**
 * From
 * https://github.com/Leaflet/Leaflet.markercluster/blob/31360f2/src/MarkerCluster.Spiderfier.js#L55-L72
 * Arranges points in a circle around the cluster center, with a line pointing from the center to
 * each point.
 * @param {number} count Number of cluster members.
 * @param {Array<number>} clusterCenter Center coordinate of the cluster.
 * @param {number} resolution Current view resolution.
 * @return {Array<Array<number>>} An array of coordinates representing the cluster members.
 */
function generatePointsCircle(count, clusterCenter, resolution) {
  const circumference =
    circleDistanceMultiplier * circleFootSeparation * (2 + count);
  let legLength = circumference / (Math.PI * 2); //radius from circumference
  const angleStep = (Math.PI * 2) / count;
  const res = [];
  let angle;

  legLength = Math.max(legLength, 35) * resolution; // Minimum distance to get outside the cluster icon.

  for (let i = 0; i < count; ++i) {
    // Clockwise, like spiral.
    angle = circleStartAngle + i * angleStep;
    res.push([
      clusterCenter[0] + legLength * Math.cos(angle),
      clusterCenter[1] + legLength * Math.sin(angle),
    ]);
  }

  return res;
}

let hoverFeature;
/**
 * Style for convex hulls of clusters, activated on hover.
 * @param {Feature} cluster The cluster feature.
 * @return {Style|null} Polygon style for the convex hull of the cluster.
 */
function clusterHullStyle(cluster) {
  if (cluster !== hoverFeature) {
    return null;
  }
  const originalFeatures = cluster.get('features');
  const points = originalFeatures.map((feature) =>
    feature.getGeometry().getCoordinates(),
  );
  let convexHullFill;
  let convexHullStroke;

  const numPoints = points.length;

  if (numPoints <= 5) {
    convexHullFill = convexHullFillSmall;
    convexHullStroke = convexHullStrokeSmall;
  } else if (numPoints >= 5 && numPoints <= 10) {
    convexHullFill = convexHullFillMedium;
    convexHullStroke = convexHullStrokeMedium;
  } else if (numPoints >= 10) {
    convexHullFill = convexHullFillLarge;
    convexHullStroke = convexHullStrokeLarge;
  }

  return new Style({
    geometry: new Polygon([monotoneChainConvexHull(points)]),
    fill: convexHullFill,
    stroke: convexHullStroke,
  });
}

function getColorBySize(size) {
  if (size <= 5) {
    return '#1c57ff';
  } else if (size <= 10) {
    return '#00a100';
  } else if (size > 10) {
    return '#b70000';
  }
}



function clusterStyle(feature) {
  const size = feature.get('features').length;

  const circleColor = getColorBySize(size);

  const dynamicOuterCircle = new CircleStyle({
    radius: 10,
    fill: new Fill({ color: circleColor }),
  });

  const dynamicInnerCircle = new CircleStyle({
    radius: 4,
    fill: new Fill({ color: circleColor }),
  });

  if (size > 1) {
    return [
      new Style({
        image: dynamicOuterCircle,
      }),
      new Style({
        image: dynamicInnerCircle,
        text: new Text({
          text: size.toString(),
          fill: textFill,
          stroke: textStroke,
        }),
      }),
    ];
  }
  const originalFeature = feature.get('features')[0];
  return clusterMemberStyle(originalFeature);
}

const vectorSource = new VectorSource({
  format: new GeoJSON(),
  url: 'data/deduped_data.json',
});

const clusterSource = new Cluster({
  distance: 35,
  source: vectorSource,
});

// Layer displaying the convex hull of the hovered cluster.
const clusterHulls = new VectorLayer({
  source: clusterSource,
  style: clusterHullStyle,
});

// Layer displaying the clusters and individual features.
const clusters = new VectorLayer({
  source: clusterSource,
  style: clusterStyle,
});

// Layer displaying the expanded view of overlapping cluster members.
const clusterCircles = new VectorLayer({
  source: clusterSource,
  style: clusterCircleStyle,
});

const osm = new TileLayer({
  source: new OSM(),
});

const mapbox_api_key = 'pk.eyJ1Ijoic2t3MTMzNSIsImEiOiJjbHhrbzh3bjcwM2U2MmpwdGs2dW9rd2VwIn0.sP8c7ShOG2tMIhCJzEcJaQ'


const mapbox_map = new MapboxVectorLayer({
  styleUrl: 'mapbox://styles/mapbox/streets-v12',
  accessToken: mapbox_api_key,
});

const source = new VectorSource();
const lc = new VectorLayer({
  source: source,
});

const map = new Map({
  layers: [mapbox_map, lc, clusterHulls, clusters, clusterCircles],
  target: 'map',
  view: new View({
    center: [0, 0],
    zoom: 2,
    maxZoom: 19,
    extent: [
      ...fromLonLat([-71.180772, 42.252779]),
      ...fromLonLat([-71.015035, 42.472732]),
    ],
    showFullExtent: true,
  }),
});

navigator.geolocation.watchPosition(
  function (pos) {
    const coords = [pos.coords.longitude, pos.coords.latitude];
    //const accuracy = circular(coords, pos.coords.accuracy);
    source.clear(true);
    source.addFeatures([
      //new Feature(
      //  accuracy.transform('EPSG:4326', map.getView().getProjection())
      //),
      new Feature(new Point(fromLonLat(coords))),
    ]);
    const features = source.getFeatures()

    const points = features[0].getGeometry().getCoordinates()
    console.log(points)

  },
  function (error) {
    alert(`ERROR: ${error.message}`);
  },
  {
    enableHighAccuracy: true,
  }
);



const locate = document.createElement('div');
locate.className = 'ol-control ol-unselectable locate';
locate.innerHTML = '<button title="Locate me">◎</button>';
locate.addEventListener('click', function () {
  if (!source.isEmpty()) {
    const loc = source.getFeatures()
    const center = loc[0].getGeometry().getCoordinates()
    const view = map.getView()
    view.animate({
      center: center,
      zoom: 15,
    });
  }
});

map.addControl(
  new Control({
    element: locate,
  })
);



map.on('pointermove', (event) => {
  clusters.getFeatures(event.pixel).then((features) => {
    if (features[0] !== hoverFeature) {
      // Display the convex hull on hover.
      hoverFeature = features[0];
      clusterHulls.setStyle(clusterHullStyle);
      // Change the cursor style to indicate that the cluster is clickable.
      map.getTargetElement().style.cursor =
        hoverFeature && hoverFeature.get('features').length > 1
          ? 'pointer'
          : '';
    }
  });
});

map.on('click', (event) => {
  clusters.getFeatures(event.pixel).then((features) => {
    if (features.length > 0) {
      const clusterMembers = features[0].get('features');
      if (clusterMembers.length > 1) {
        // Calculate the extent of the cluster members.
        const extent = createEmpty();
        clusterMembers.forEach((feature) =>
          extend(extent, feature.getGeometry().getExtent()),
        );
        const view = map.getView();
        const resolution = map.getView().getResolution();
        if (
          view.getZoom() === view.getMaxZoom() ||
          (getWidth(extent) < resolution && getHeight(extent) < resolution)
        ) {
          // Show an expanded view of the cluster members.
          clickFeature = features[0];
          clickResolution = resolution;
          clusterCircles.setStyle(clusterCircleStyle);
        } else {
          // Zoom to the extent of the cluster members.
          view.fit(extent, { duration: 500, padding: [50, 50, 50, 50] });
        }
      }
    }
  });
});

