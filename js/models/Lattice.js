/**
 * Created by aghassaei on 1/16/15.
 */


Lattice = Backbone.Model.extend({

    defaults: {

        units: "mm",

        nodes: [],
        cells: [[[null]]],//3D matrix containing all cells and null, dynamic size
        cellsMin: {x:0, y:0, z:0},//min position of cells matrix
        cellsMax: {x:0, y:0, z:0},//max position of cells matrix
        numCells: 0,

        basePlane: null,//plane to build from
        scale: 60,
        highlighter: null,//highlights build-able surfaces

        //spacing for connectors/joints
        cellSeparation: {xy:0, z:0},

        cellType: "octa",
        freeformCellType: "tetra",
        connectionType: "freeformFace",
        partType: "trox"
    },

    //pass in fillGeometry

    initialize: function(options){

        _.extend(this, OctaLatticeSubclasses, OtherLatticeSubclasses);

        //bind events
        this.listenTo(this, "change:scale", this._scaleDidChange);
        this.listenTo(options.appState, "change:cellMode", this._updateForMode);
        this.listenTo(this, "change:partType", this._updatePartType);
        this.listenTo(this, "change:cellType change:connectionType", this._updateLatticeType);
        this.listenTo(this, "change:cellSeparation", this._updateCellSeparation);
        this.listenTo(options.appState, "change:cellsVisible", this._setCellVisibility);
    },

    delayedInit: function(){
        this._updateLatticeType();
    },

    ////////////////////////////////////////////////////////////////////////////////////
    ///////////////////////////////ADD/REMOVE CELLS/////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////////////////

    addCellsInRange: function(range){//add a block of cells (extrude)
        var scale = this.get("scale");
        var cells = this.get("cells");
        this.checkForMatrixExpansion(cells, range.max, range.min);

        var cellsMin = this.get("cellsMin");
        var relativeMin = this._subtract(range.min, cellsMin);
        var relativeMax = this._subtract(range.max, this.get("cellsMin"));

        for (var x=relativeMin.x;x<=relativeMax.x;x++){
            for (var y=relativeMin.y;y<=relativeMax.y;y++){
                for (var z=relativeMin.z;z<=relativeMax.z;z++){
                    if (!cells[x][y][z]) {
                        cells[x][y][z] = this.makeCellForLatticeType(this._add({x:x, y:y, z:z}, cellsMin), scale);
                        this.set("numCells", this.get("numCells")+1);
                    } else console.warn("already a cell there");
                }
            }
        }
        dmaGlobals.three.render();
    },

    addCellAtIndex: function(indices, noRender, noCheck){

        var scale = this.get("scale");
        var cells = this.get("cells");
        if (!noCheck) this.checkForMatrixExpansion(cells, indices, indices);

        var index = this._subtract(indices, this.get("cellsMin"));
        if (!cells[index.x][index.y][index.z]) {
            cells[index.x][index.y][index.z] = this.makeCellForLatticeType(indices, scale);
            this.set("numCells", this.get("numCells")+1);
            if (!noRender) dmaGlobals.three.render();
        } else console.warn("already a cell there");

    },

    _indexForPosition: function(absPosition){
        var position = {};
        var scale = this.get("scale");
        position.x = Math.floor(absPosition.x/this.xScale(scale));
        position.y = Math.floor(absPosition.y/this.yScale(scale));
        position.z = Math.floor(absPosition.z/this.zScale(scale));
        return position;
    },

    _positionForIndex: function(index){
        var scale = this.get("scale");
        var position = _.clone(index);
        position.x = (position.x+0.5)*this.xScale(scale);
        position.y = (position.y+0.5)*this.yScale(scale);
        position.z = (position.z+0.5)*this.zScale(scale);
        return position;
    },

//    removeCellAtIndex: function(indices){
//
//        var index = this._subtract(indices, this.get("cellsMin"));
//        var cells = this.get("cells");
//        if (index.x<cells.length && index.y<cells[0].length && index.z<cells[0][0].length){
//            this.removeCell(cells[index.x][index.y][index.z]);
//        }
//    },

    removeCell: function(cell){
        if (!cell) return;
        var index = this._subtract(cell.indices, this.get("cellsMin"));
        var cells = this.get("cells");
        cell.destroy();
        cells[index.x][index.y][index.z] = null;

        //todo shrink cells matrix if needed

        this.set("numCells", this.get("numCells")-1);
        dmaGlobals.three.render();
    },

    //todo send clear all to three and destroy without sceneRemove to cell
    clearCells: function(){
        this._iterCells(this.get("cells"), function(cell){
            if (cell && cell.destroy) cell.destroy();
        });
        this.set("cells", [[[null]]]);
        this.set("cellsMax", {x:0, y:0, z:0});
        this.set("cellsMin", {x:0, y:0, z:0});
        this.set("nodes", []);
        this.set("numCells", 0);
        if (this.get("basePlane")) this.get("basePlane").set("zIndex", 0);
        dmaGlobals.three.render();
        dmaGlobals.appState.set("deleteMode", false);
    },

    calculateBoundingBox: function(){
        var scale = this._allAxesScales();
        var min = _.clone(this.get("cellsMin"));
        var max = _.clone(this.get("cellsMax"));
        _.each(_.keys(scale), function(key){
            min[key] *= scale[key];
            max[key] *= scale[key];
        });
        return {min:min, max:max};
    },

    _allAxesScales: function(){
        var scale = this.get("scale");
        var xScale = this.xScale(scale);
        var yScale = this.yScale(scale);
        var zScale = this.zScale(scale);
        return {x:xScale, y:yScale, z:zScale};
    },

    ////////////////////////////////////////////////////////////////////////////////////
    ///////////////////////////////FILL GEOMETRY////////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////////////////

    subtractMesh: function(mesh){
        //todo this is specific to octa face

        var scale = this.get("scale");
        var xScale = this.xScale(scale);
        var yScale = this.yScale(scale);
        var zScale = this.zScale(scale);

        var cells = this.get("cells");
        var cellsMin = this.get("cellsMin");

        var allVertexPos = mesh.geometry.attributes.position.array;

        var zHeight = 0;
        for (var x=0;x<cells.length;x++){
            for (var y=0;y<cells[0].length;y++){
                var firstCell = null;
                for (var z=0;z<cells[0][0].length;z++){
                    firstCell = cells[x][y][z];
                    if (firstCell) break;
                }
                if (!firstCell) continue;//nothing in col

                var origin = this._positionForIndex(firstCell.indices);
//                    firstCell._calcPosition(0, this._add({x:x,y:y,z:z}, cellsMin));
                zHeight = this._findIntersectionsInWindow(xScale/2, yScale/2, origin, allVertexPos) || zHeight;

                zHeight = Math.floor(zHeight/zScale);
                for (var z=0;z<zHeight;z++){
                    var cell = cells[x][y][z];
                    if (cell) cell.destroy();
                    cells[x][y][z] = null;
                }
            }

        }
        dmaGlobals.three.render();
    },

    _findIntersectionsInWindow: function(windowX, windowY, origin, allVertexPos){
        for (var i=0;i<allVertexPos.length;i+=3){
            if (allVertexPos[i] > origin.x-windowX && allVertexPos[i] < origin.x+windowX
                && allVertexPos[i+1] > origin.y-windowY && allVertexPos[i+1] < origin.y+windowY){
                return allVertexPos[i+2];
            }
        }
        return null
    },


    ////////////////////////////////////////////////////////////////////////////////////
    ///////////////////////////////CELLS ARRAY//////////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////////////////

    checkForMatrixExpansion: function(cells, indicesMax, indicesMin){

        if (!cells) cells = this.get("cells");

        var lastMax = this.get("cellsMax");
        var lastMin = this.get("cellsMin");
        var newMax = this._updateCellsMax(indicesMax, lastMax);
        var newMin = this._updateCellsMin(indicesMin, lastMin);
        if (newMax) {
            this._expandCellsArray(cells, this._subtract(newMax, lastMax), false);
            this.set("cellsMax", newMax);
        }
        if (newMin) {
            this._expandCellsArray(cells, this._subtract(lastMin, newMin), true);
            this.set("cellsMin", newMin);
        }
    },

    _expandCellsArray: function(cells, expansion, fromFront){

        _.each(_.keys(expansion), function(key){
            if (expansion[key] == 0) return;//no expansion on this axis

            var cellsX = cells.length;
            var cellsY = cells[0].length;
            var cellsZ = cells[0][0].length;

            if (key=="x"){
                for (var x=0;x<expansion[key];x++){
                    var newLayer = [];
                    for (var y=0;y<cellsY;y++){
                        var newCol = [];
                        for (var z=0;z<cellsZ;z++){
                            newCol.push(null);
                        }
                        newLayer.push(newCol);
                    }
                    if (fromFront) cells.unshift(newLayer);
                    else cells.push(newLayer);
                }
            } else if (key=="y"){
                for (var x=0;x<cellsX;x++){
                    for (var y=0;y<expansion[key];y++){
                        var newCol = [];
                        for (var z=0;z<cellsZ;z++){
                            newCol.push(null);
                        }
                        if (fromFront) cells[x].unshift(newCol);
                        else cells[x].push(newCol);
                    }
                }
            } else if (key=="z"){
                for (var x=0;x<cellsX;x++){
                    for (var y=0;y<cellsY;y++){
                        for (var z=0;z<expansion[key];z++){
                            if (fromFront) cells[x][y].unshift(null);
                            else cells[x][y].push(null);
                        }
                    }
                }
            }
        });
    },

    _updateCellsMin: function(newPosition, currentMin){
        var newMin = {};
        var hasChanged = false;
        _.each(_.keys(newPosition), function(key){
            if (newPosition[key]<currentMin[key]){
                hasChanged = true;
                newMin[key] = newPosition[key];
            } else {
                newMin[key] = currentMin[key];
            }
        });
        if (hasChanged) return newMin;
        return false;
    },

    _updateCellsMax: function(newPosition, currentMax){
        var newMax = {};
        var hasChanged = false;
        _.each(_.keys(newPosition), function(key){
            if (newPosition[key]>currentMax[key]){
                hasChanged = true;
                newMax[key] = newPosition[key];
            } else {
                newMax[key] = currentMax[key];
            }
        });
        if (hasChanged) return newMax;
        return false;
    },

    _subtract: function(pos1, pos2){
        return {x:pos1.x-pos2.x, y:pos1.y-pos2.y, z:pos1.z-pos2.z};
    },

    _add: function(pos1, pos2){
        return {x:pos1.x+pos2.x, y:pos1.y+pos2.y, z:pos1.z+pos2.z};
    },

    ////////////////////////////////////////////////////////////////////////////////////
    ////////////////////////////////////EVENTS//////////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////////////////

    _updatePartType: function(){
        this._iterCells(this.get("cells"), function(cell){
            if (cell) cell.destroyParts();
        });
        this._updateForMode();
    },

    _updateForMode: function(){
        var cellMode = dmaGlobals.appState.get("cellMode");
        var partType =  this.get("partType");
        var scale = this.get("scale");
        this._iterCells(this.get("cells"), function(cell){
            if (cell) cell.draw(scale, cellMode, partType);
        });
        dmaGlobals.three.render();
    },

    _updateCellSeparation: function(){
        var cellSep = this.get("cellSeparation");
        this.get("basePlane").updateXYSeparation(cellSep.xy);

        var scale = this.get("scale");
        var cellMode = dmaGlobals.appState.get("cellMode");
        var partType = this.get("partType");
        this._iterCells(this.get("cells"), function(cell){
            if (cell) cell.updateForScale(scale, cellMode, partType);
        });
        dmaGlobals.three.render();
    },

    _scaleDidChange: function(){
        var scale = this.get("scale");
        this.get("basePlane").updateScale(scale);
        this.get("highlighter").updateScale(scale);

        var cellMode = dmaGlobals.appState.get("cellMode");
        var partType = this.get("partType");
        this._iterCells(this.get("cells"), function(cell){
            if (cell && cell.updateForScale) cell.updateForScale(scale, cellMode, partType);
        });

        dmaGlobals.three.render();
    },

    previewScaleChange: function(scale){
        this.get("basePlane").updateScale(scale);
    },

    _setCellVisibility: function(){//todo maybe leave wireframes?
        if (dmaGlobals.appState.get("cellsVisible")) this.showCells();
        else this.hideCells();
    },

    //hide show cells during stock simulation
    hideCells: function(){
        this._iterCells(this.get("cells"), function(cell){
            if (cell) {
                cell.hide();
                cell.hideForStockSimulation = true;
            }
        });
        dmaGlobals.three.render();
    },

    showCells: function(){
        this._iterCells(this.get("cells"), function(cell){
            if (cell) {
                cell.hideForStockSimulation = false;
                cell.draw();
            }
        });
        dmaGlobals.three.render();
    },

    showCellAtIndex: function(index){
        var latticeIndex = this._subtract(index, this.get("cellsMin"));
        var cell = this.get("cells")[latticeIndex.x][latticeIndex.y][latticeIndex.z];
        if (cell) {
            cell.hideForStockSimulation = false;
            cell.draw();
        }
        else console.warn("placing a cell that does not exist");
    },

    ////////////////////////////////////////////////////////////////////////////////////
    ///////////////////////////////CONNECTION TYPE//////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////////////////

    _updateLatticeType: function(arg1, arg2, arg3, loadingFromFile){//do not clear cells if loading from file (cells array contains important metadata)

        this._setDefaultCellMode();

        if (typeof loadingFromFile == "undefined") loadingFromFile = false;
        var cellType = this.get("cellType");
        var connectionType = this.get("connectionType");
        if (this._undo) this._undo();
        if (this.get("basePlane")) this.get("basePlane").destroy();
        if (this.get("highlighter")) this.get("highlighter").destroy();
        if (cellType == "octa"){
            if (connectionType == "face"){
                _.extend(this, this.OctaFaceLattice);
            } else if (connectionType == "freeformFace"){
                if (!loadingFromFile) this.clearCells();
                _.extend(this, this.OctaFreeFormFaceLattice);
            } else if (connectionType == "edge"){
                _.extend(this, this.OctaFaceLattice);
                _.extend(this, this.OctaEdgeLattice);
            } else if (connectionType == "edgeRot"){
                _.extend(this, this.OctaRotEdgeLattice);
            } else if (connectionType == "vertex"){
                _.extend(this, this.OctaVertexLattice);
            }
        } else if (cellType == "tetra"){
            _.extend(this, this.CubeLattice);
        } else if (cellType == "cube"){
            _.extend(this, this.CubeLattice);
        } else if (cellType == "truncatedCube"){
            _.extend(this, this.TruncatedCubeLattice);
        } else if (cellType == "kelvin"){
            _.extend(this, this.KelvinLattice);
        }
        this._initLatticeType();

        //todo refactor this eventually
        var self = this;
        var scale = this.get("scale");
        var cells = this.get("cells");
        this._loopCells(cells, function(cell, x, y, z){
            if (!cell) return;

            var index = _.clone(cell.indices);
            //var  parts = null;
            //if (loadingFromFile) parts = _.clone(cell.parts);
            if (cell.parentOrientation) var parentOrientation = new THREE.Quaternion(cell.parentOrientation._x, cell.parentOrientation._y, cell.parentOrientation._z, cell.parentOrientation._w);
            if (cell.parentPosition) var parentPos = cell.parentPosition;
            if (cell.direction) var direction = new THREE.Vector3(cell.direction.x, cell.direction.y, cell.direction.z);
            if (cell.parentType) var parentType = cell.parentType;
            if (cell.type) var type = cell.type;

            if (cell.destroy) cell.destroy();
            var newCell = self.makeCellForLatticeType(index, scale, parentPos, parentOrientation, direction, parentType, type);

            //if (parts) {
            //    //todo make this better
            //    newCell.parts = newCell._initParts();
            //    for (var i=0;i<newCell.parts.length;i++){
            //        if (!parts[i]) {
            //            newCell.parts[i].destroy();
            //            newCell.parts[i] = null;
            //        }
            //    }
            //}
            cells[x][y][z] = newCell;
        });
        dmaGlobals.three.render();
    },

    _setDefaultCellMode: function(){
        if (!dmaGlobals.appState.get("allPartTypes")[this.get("cellType")][this.get("connectionType")]){
            dmaGlobals.appState.set("cellMode", "cell");
        }
    },

    ////////////////////////////////////////////////////////////////////////////////////
    ////////////////////////////////////UTILS///////////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////////////////

    _iterCells: function(cells, callback){
        _.each(cells, function(cellLayer){
            _.each(cellLayer, function(cellColumn){
                _.each(cellColumn, function(cell){
                    callback(cell, cellColumn, cellLayer);
                });
            });

        });
    },

    _loopCells: function(cells, callback){
        for (var x=0;x<cells.length;x++){
            for (var y=0;y<cells[0].length;y++){
                for (var z=0;z<cells[0][0].length;z++){
                    callback(cells[x][y][z], x, y, z);
                }
            }
        }
    },

    rasterCells: function(order, callback, var1, var2, var3, cells){//used for CAM raster x/y/z in any order permutation
        //order is of form 'XYZ'
        var firstLetter = order.charAt(0);
        order = order.substr(1);
        var isNeg = false;
        if (firstLetter == "-") {
            isNeg = true;
            firstLetter = order.charAt(0);
            order = order.substr(1);
        }
        if (!cells) cells = this.get("cells");//grab cells once at beginning and hold onto it in case changes are made while looping
        var newVarOrder;
        var newVarDim;
        if (firstLetter == 'X'){
            newVarOrder = 0;
            newVarDim = cells.length;
        } else if (firstLetter == 'Y'){
            newVarOrder = 1;
            newVarDim = cells[0].length;
        } else if (firstLetter == 'Z'){
            newVarOrder = 2;
            newVarDim = cells[0][0].length;
        } else if (firstLetter == ""){
            for (var i=this._getRasterLoopInit(var1);this._getRasterLoopCondition(i,var1);i+=this._getRasterLoopIterator(var1)){
                for (var j=this._getRasterLoopInit(var2);this._getRasterLoopCondition(j,var2);j+=this._getRasterLoopIterator(var2)){
                    for (var k=this._getRasterLoopInit(var3);this._getRasterLoopCondition(k,var3);k+=this._getRasterLoopIterator(var3)){
                        if (var1.order == 0){
                            if (var2.order == 1) callback(cells[i][j][k], i, j, k);
                            else if (var2.order == 2) callback(cells[i][k][j], i, k, j);
                        } else if (var1.order == 1){
                            if (var2.order == 0) callback(cells[j][i][k], j, i, k);
                            else if (var2.order == 2) callback(cells[k][i][j], k, i, j);
                        } else {
                            if (var2.order == 0) callback(cells[j][k][i], j, k, i);
                            else if (var2.order == 1) {
                                callback(cells[k][j][i], k, j, i);
                            }
                        }

                    }
                }
            }
            return;
        }
        if (var3 == null) var3 = {order: newVarOrder, dim: newVarDim, neg:isNeg};
        else if (var2  == null) var2 = {order: newVarOrder, dim: newVarDim, neg:isNeg};
        else var1 = {order: newVarOrder, dim: newVarDim, neg:isNeg};
        this.rasterCells(order, callback, var1, var2, var3, cells);
    },

    _getRasterLoopInit: function(variable){
        if (variable.neg) return variable.dim-1;
        return 0;
    },

    _getRasterLoopCondition: function(iter, variable){
        if (variable.neg) return iter>=0;
        return iter<variable.dim;
    },

    _getRasterLoopIterator: function(variable){
        if (variable.neg) return -1;
        return 1;
    },

    ////////////////////////////////////////////////////////////////////////////////////
    ///////////////////////////////UI///////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////////////////

    toJSON: function(){//a minimal toJSON for ui stuff - no need to parse all cells
        return _.omit(this.attributes, ["cells", "nodes"]);
    },//todo something weird here

    toJSONFull: function(){//for saving only - it's ok to pass attributes
        return this.attributes;
    }

});