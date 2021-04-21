(ns utils-test
  (:require [clojure.test :refer [deftest is testing]]
            [utils :refer [process-move]]))

(deftest process-move-valid-1-digit-count
  (testing "process-move handles a count with 1 digit"
    (is (= (get (process-move "ab3") :count) 3))))

(deftest process-move-valid-2-digits-count
  (testing "process-move handles a count with 2 digits"
    (is (= (get (process-move "ab13") :count) 13))))

(deftest process-move-valid-3-digits-count
  (testing "process-move handles a count with 3 digits"
    (is (= (get (process-move "ab931") :count) 931))))
